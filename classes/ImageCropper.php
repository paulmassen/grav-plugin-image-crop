<?php

declare(strict_types=1);

namespace Grav\Plugin\ImageCrop;

use Grav\Common\Page\Medium\ImageFile;
use RuntimeException;

/**
 * Crops an image file with Grav's own image library (GD or Imagick, as set in
 * system.images.adapter).
 *
 * Coordinates are expressed in the image as it is DISPLAYED: browsers apply the
 * EXIF orientation of JPEG photos, so the EXIF rotation is applied here before
 * cropping (the saved file is then stored upright, without EXIF data).
 */
class ImageCropper
{
    /** Extensions that can be cropped => Grav image library output type. */
    public const TYPES = [
        'jpg' => 'jpg',
        'jpeg' => 'jpg',
        'png' => 'png',
        'webp' => 'webp',
        'gif' => 'gif',
        'avif' => 'avif',
    ];

    /** Minimum size of a crop, in pixels. */
    public const MIN_SIZE = 1;

    /** @var int */
    private $maxPixels;

    /** @var string Grav image adapter (system.images.adapter): gd or imagick */
    private $adapter;

    public function __construct(int $maxMegapixels = 60, string $adapter = 'gd')
    {
        $this->maxPixels = max(1, $maxMegapixels) * 1000000;
        $this->adapter = strtolower($adapter) === 'imagick' && class_exists('Imagick') ? 'imagick' : 'gd';
    }

    /**
     * Information about an image file, as needed by the crop editor.
     *
     * @return array{supported: bool, reason: string|null, mime: string, extension: string, width: int, height: int, orientation: int}
     */
    public function inspect(string $file): array
    {
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $info = @getimagesize($file);
        $mime = is_array($info) ? (string) ($info['mime'] ?? '') : (string) (@mime_content_type($file) ?: '');
        $width = is_array($info) ? (int) $info[0] : 0;
        $height = is_array($info) ? (int) $info[1] : 0;
        $orientation = $this->exifOrientation($file, $mime);

        // EXIF orientations 5-8 rotate the image by 90°: displayed width/height are swapped.
        if ($orientation >= 5 && $orientation <= 8) {
            [$width, $height] = [$height, $width];
        }

        $reason = null;
        if (!isset(self::TYPES[$extension]) || !is_array($info)) {
            $reason = 'unsupported_format';
        } elseif (!$this->adapterSupports($extension)) {
            $reason = 'format_not_available';
        } elseif ($width * $height > $this->maxPixels) {
            $reason = 'too_large';
        } elseif ($extension === 'gif' && $this->isAnimatedGif($file)) {
            $reason = 'animated_gif';
        }

        return [
            'supported' => $reason === null,
            'reason' => $reason,
            'mime' => $mime,
            'extension' => $extension,
            'width' => $width,
            'height' => $height,
            'orientation' => $orientation,
        ];
    }

    /**
     * Crop $source into $destination ($destination may be $source itself).
     *
     * The result is written to a temporary file in the destination folder
     * first, then renamed over the destination, so a failure never leaves a
     * truncated image behind.
     *
     * @param array{x: int, y: int, width: int, height: int} $rect Crop rectangle in displayed pixels
     * @return array{width: int, height: int}
     */
    public function crop(string $source, string $destination, array $rect, int $quality): array
    {
        $info = $this->inspect($source);
        if (!$info['supported']) {
            throw new RuntimeException('Image cannot be cropped: ' . $info['reason']);
        }

        $rect = $this->clampRect($rect, $info['width'], $info['height']);
        $type = self::TYPES[$info['extension']];
        $quality = max(1, min(100, $quality));

        $tmp = dirname($destination) . '/.' . basename($destination) . '.' . bin2hex(random_bytes(4)) . '.tmp.' . $info['extension'];

        try {
            $image = ImageFile::open($source);
            $image->useFallback(false);

            if ($info['orientation'] > 1) {
                $image->fixOrientation();
            }

            $image->crop($rect['x'], $rect['y'], $rect['width'], $rect['height']);

            $result = $image->save($tmp, $type, $quality);
            if ($result === false || !is_file($tmp) || filesize($tmp) === 0) {
                throw new RuntimeException('The image library could not write the cropped image.');
            }

            $saved = @getimagesize($tmp);
            if (!is_array($saved)) {
                throw new RuntimeException('The cropped image is not readable.');
            }

            // Keep the permissions of the file being replaced.
            if (is_file($destination)) {
                @chmod($tmp, fileperms($destination) & 0777);
            } else {
                @chmod($tmp, 0664);
            }

            if (!@rename($tmp, $destination)) {
                throw new RuntimeException('The cropped image could not be moved into place.');
            }
            @touch($destination);
            clearstatcache(true, $destination);

            return ['width' => (int) $saved[0], 'height' => (int) $saved[1]];
        } finally {
            if (is_file($tmp)) {
                @unlink($tmp);
            }
        }
    }

    /**
     * Round and validate a crop rectangle against the displayed image size.
     *
     * @param array<string, mixed> $rect
     * @return array{x: int, y: int, width: int, height: int}
     */
    public function clampRect(array $rect, int $imageWidth, int $imageHeight): array
    {
        foreach (['x', 'y', 'width', 'height'] as $key) {
            if (!isset($rect[$key]) || !is_numeric($rect[$key])) {
                throw new \InvalidArgumentException("Crop value '{$key}' is missing or not a number.");
            }
        }

        $x = (int) round((float) $rect['x']);
        $y = (int) round((float) $rect['y']);
        $width = (int) round((float) $rect['width']);
        $height = (int) round((float) $rect['height']);

        // Tolerate sub-pixel overflow coming from the browser, reject real nonsense.
        $x = max(0, min($x, $imageWidth - self::MIN_SIZE));
        $y = max(0, min($y, $imageHeight - self::MIN_SIZE));
        $width = min($width, $imageWidth - $x);
        $height = min($height, $imageHeight - $y);

        if ($width < self::MIN_SIZE || $height < self::MIN_SIZE) {
            throw new \InvalidArgumentException('The crop area is empty.');
        }

        return ['x' => $x, 'y' => $y, 'width' => $width, 'height' => $height];
    }

    private function exifOrientation(string $file, string $mime): int
    {
        if ($mime !== 'image/jpeg' || !function_exists('exif_read_data')) {
            return 1;
        }

        $exif = @exif_read_data($file);
        $orientation = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;

        return $orientation >= 1 && $orientation <= 8 ? $orientation : 1;
    }

    private function adapterSupports(string $extension): bool
    {
        if ($this->adapter === 'imagick') {
            $formats = array_map('strtolower', \Imagick::queryFormats());
            $wanted = $extension === 'jpg' ? 'jpeg' : $extension;

            return in_array($wanted, $formats, true);
        }

        if (!function_exists('imagetypes')) {
            return false;
        }

        $types = imagetypes();
        switch ($extension) {
            case 'jpg':
            case 'jpeg':
                return (bool) ($types & IMG_JPG);
            case 'png':
                return (bool) ($types & IMG_PNG);
            case 'gif':
                return (bool) ($types & IMG_GIF);
            case 'webp':
                return defined('IMG_WEBP') && (bool) ($types & IMG_WEBP);
            case 'avif':
                return defined('IMG_AVIF') && (bool) ($types & IMG_AVIF);
        }

        return false;
    }

    private function isAnimatedGif(string $file): bool
    {
        $handle = @fopen($file, 'rb');
        if (!$handle) {
            return false;
        }

        $frames = 0;
        $chunk = '';
        while (!feof($handle) && $frames < 2) {
            $chunk .= fread($handle, 1024 * 100);
            $frames += preg_match_all('#\x00\x21\xF9\x04.{4}\x00[\x2C\x21]#s', $chunk);
            $chunk = substr($chunk, -20);
        }
        fclose($handle);

        return $frames > 1;
    }
}
