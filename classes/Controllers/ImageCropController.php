<?php

declare(strict_types=1);

namespace Grav\Plugin\ImageCrop\Controllers;

use Grav\Common\Page\Interfaces\PageInterface;
use Grav\Framework\Psr7\Response;
use Grav\Plugin\Api\Controllers\AbstractApiController;
use Grav\Plugin\Api\Exceptions\ForbiddenException;
use Grav\Plugin\Api\Exceptions\NotFoundException;
use Grav\Plugin\Api\Exceptions\ValidationException;
use Grav\Plugin\Api\Response\ApiResponse;
use Grav\Plugin\Api\Services\ThumbnailService;
use Grav\Plugin\ImageCrop\ImageCropper;
use Grav\Plugin\ImageCropPlugin;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Symfony\Component\Yaml\Yaml;

/**
 * API endpoints of the Admin2 crop editor.
 *
 * A media file is addressed like the API plugin does it:
 *  - page media: source=page, route=<page route>, filename=<file name>
 *  - site media: source=site, path=<path relative to user://media, file name included>
 *
 *   GET  /image-crop/info   Image information for the editor
 *   GET  /image-crop/image  The image itself (authenticated, never cached)
 *   POST /image-crop/crop   Crop: overwrite the image or save a copy
 */
class ImageCropController extends AbstractApiController
{
    private const MEDIA_ORDER_FILE = 'media_order.yaml';

    /**
     * GET /image-crop/info
     */
    public function info(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, ImageCropPlugin::PERMISSION);

        $target = $this->resolveTarget($request, $request->getQueryParams(), 'read');
        $inspect = $this->cropper()->inspect($target['file']);

        return ApiResponse::create([
            'source' => $target['source'],
            'route' => $target['route'],
            'path' => $target['path'],
            'filename' => $target['filename'],
            'mime' => $inspect['mime'],
            'extension' => $inspect['extension'],
            'width' => $inspect['width'],
            'height' => $inspect['height'],
            'size' => (int) filesize($target['file']),
            'modified' => date(\DateTimeInterface::ATOM, (int) filemtime($target['file'])),
            'supported' => $inspect['supported'],
            'reason' => $inspect['reason'],
            'copy_name' => (string) $this->config->get('plugins.image-crop.copy_name', '{name}-{width}x{height}'),
        ]);
    }

    /**
     * GET /image-crop/image - stream the original image for the editor.
     */
    public function image(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, ImageCropPlugin::PERMISSION);

        $target = $this->resolveTarget($request, $request->getQueryParams(), 'read');
        $inspect = $this->cropper()->inspect($target['file']);
        if (!str_starts_with($inspect['mime'], 'image/') || $inspect['mime'] === 'image/svg+xml') {
            throw new ValidationException('This file is not a raster image.');
        }

        return new Response(200, [
            'Content-Type' => $inspect['mime'],
            'Content-Length' => (string) filesize($target['file']),
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
        ], (string) file_get_contents($target['file']));
    }

    /**
     * POST /image-crop/crop
     *
     * Body: source, route|path, filename, x, y, width, height,
     *       mode (overwrite|copy), name (copy only, optional)
     */
    public function crop(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, ImageCropPlugin::PERMISSION);

        $body = $this->getRequestBody($request);
        $target = $this->resolveTarget($request, $body, 'update');

        $mode = (string) ($body['mode'] ?? '');
        if (!in_array($mode, ['overwrite', 'copy'], true)) {
            throw new ValidationException("'mode' must be 'overwrite' or 'copy'.");
        }

        $cropper = $this->cropper();
        $inspect = $cropper->inspect($target['file']);
        if (!$inspect['supported']) {
            throw new ValidationException($this->reasonMessage((string) $inspect['reason']));
        }

        try {
            $rect = $cropper->clampRect([
                'x' => $body['x'] ?? null,
                'y' => $body['y'] ?? null,
                'width' => $body['width'] ?? null,
                'height' => $body['height'] ?? null,
            ], $inspect['width'], $inspect['height']);
        } catch (\InvalidArgumentException $e) {
            throw new ValidationException($e->getMessage());
        }

        $dir = dirname($target['file']);
        if (!is_writable($dir) || ($mode === 'overwrite' && !is_writable($target['file']))) {
            throw new ForbiddenException('The media folder is not writable by the web server.');
        }

        $previousThumbnail = $this->thumbnailUrl($target['logical'], $inspect['mime']);

        if ($mode === 'overwrite') {
            $destination = $target['file'];
            $filename = $target['filename'];
        } else {
            $filename = $this->copyFilename($dir, $target['filename'], (string) ($body['name'] ?? ''), $rect);
            $destination = $dir . '/' . $filename;
        }

        $quality = (int) $this->config->get('plugins.image-crop.quality', 90);

        try {
            $size = $cropper->crop($target['file'], $destination, $rect, $quality);
        } catch (\Throwable $e) {
            $this->grav['log']->error('Image Crop: ' . $e->getMessage() . ' (' . $target['file'] . ')');
            throw new ValidationException('The image could not be cropped: ' . $e->getMessage());
        }

        if ($mode === 'copy') {
            $this->afterCopy($target, $filename);
        }

        $relativePath = $target['source'] === 'site'
            ? ltrim(($target['folder'] !== '' ? $target['folder'] . '/' : '') . $filename, '/')
            : null;

        $this->fireEvent('onImageCropSaved', [
            'mode' => $mode,
            'source' => $target['source'],
            'page' => $target['page'],
            'path' => $relativePath,
            'original' => $target['file'],
            'file' => $destination,
            'rect' => $rect,
        ]);

        $mime = (string) (@mime_content_type($destination) ?: $inspect['mime']);

        $data = [
            'mode' => $mode,
            'source' => $target['source'],
            'route' => $target['route'],
            'path' => $relativePath,
            'folder' => $target['folder'],
            'filename' => $filename,
            'original_filename' => $target['filename'],
            'dimensions' => $size,
            'size' => (int) filesize($destination),
            'modified' => date(\DateTimeInterface::ATOM, (int) filemtime($destination)),
            'thumbnail_url' => $this->thumbnailUrl(dirname($target['logical']) . '/' . $filename, $mime),
            'previous_thumbnail_url' => $previousThumbnail,
        ];

        return ApiResponse::create($data, $mode === 'copy' ? 201 : 200, $this->invalidationHeaders($this->invalidationTags($target, $mode)));
    }

    /**
     * Resolve and validate the media file addressed by the request.
     *
     * @param array<string, mixed> $params
     * `file` is the real path (used for reading/writing), `logical` the path as
     * Grav and the API plugin see it (used for thumbnail hashes, which must
     * match the ones in the media lists even when user/ is a symlink).
     *
     * @return array{source: string, route: string|null, path: string|null, folder: string, filename: string, file: string, logical: string, page: PageInterface|null}
     */
    private function resolveTarget(ServerRequestInterface $request, array $params, string $pageAction): array
    {
        $source = (string) ($params['source'] ?? '');

        if ($source === 'page') {
            $route = trim((string) ($params['route'] ?? ''), '/');
            $filename = $this->safeFilename((string) ($params['filename'] ?? ''));
            if ($route === '') {
                throw new ValidationException("'route' is required for page media.");
            }

            $page = $this->resolvePageByRoute($route);
            if (!$page || !$page->path() || !is_dir($page->path())) {
                throw new NotFoundException("Page '/{$route}' not found.");
            }
            // Same rule as the API media endpoints: page frontmatter can deny edits.
            $this->assertPageNotDenied($request, $page, $pageAction);

            $file = $this->containedFile($page->path(), $filename);

            return [
                'source' => 'page',
                'route' => $route,
                'path' => null,
                'folder' => '',
                'filename' => $filename,
                'file' => $file,
                'logical' => rtrim($page->path(), '/') . '/' . $filename,
                'page' => $page,
            ];
        }

        if ($source === 'site') {
            $path = str_replace('\\', '/', trim((string) ($params['path'] ?? ''), '/'));
            if ($path === '') {
                throw new ValidationException("'path' is required for site media.");
            }
            foreach (explode('/', $path) as $segment) {
                if ($segment === '' || $segment === '.' || $segment === '..' || str_contains($segment, "\0") || str_starts_with($segment, '.')) {
                    throw new ValidationException('Invalid media path.');
                }
            }

            $root = $this->grav['locator']->findResource('user://media', true, true);
            if (!$root) {
                throw new NotFoundException('Site media directory could not be resolved.');
            }

            $file = $this->containedFile($root, $path);
            $folder = trim(str_contains($path, '/') ? dirname($path) : '', '/.');

            return [
                'source' => 'site',
                'route' => null,
                'path' => $path,
                'folder' => $folder,
                'filename' => basename($path),
                'file' => $file,
                'logical' => rtrim($root, '/') . '/' . $path,
                'page' => null,
            ];
        }

        throw new ValidationException("'source' must be 'page' or 'site'.");
    }

    /**
     * Absolute path of an existing file, guaranteed to sit inside $base.
     */
    private function containedFile(string $base, string $relative): string
    {
        $realBase = realpath($base);
        $real = realpath($base . '/' . $relative);

        if ($realBase === false || $real === false || !is_file($real)
            || strncmp($real, $realBase . DIRECTORY_SEPARATOR, strlen($realBase) + 1) !== 0) {
            throw new NotFoundException('Media file not found.');
        }

        return $real;
    }

    private function safeFilename(string $filename): string
    {
        if ($filename === '' || $filename !== basename($filename) || str_starts_with($filename, '.') || str_contains($filename, "\0")) {
            throw new ValidationException('Invalid file name.');
        }

        return $filename;
    }

    /**
     * Name of the copy: requested name (or the configured pattern), sanitized
     * like the API does for renames, original extension kept, never
     * overwriting an existing file.
     *
     * @param array{x: int, y: int, width: int, height: int} $rect
     */
    private function copyFilename(string $dir, string $original, string $requested, array $rect): string
    {
        $extension = pathinfo($original, PATHINFO_EXTENSION);
        $name = pathinfo($original, PATHINFO_FILENAME);

        $stem = trim($requested);
        if ($stem !== '' && $extension !== '' && strtolower((string) pathinfo($stem, PATHINFO_EXTENSION)) === strtolower($extension)) {
            $stem = pathinfo($stem, PATHINFO_FILENAME);
        }
        if ($stem === '') {
            $pattern = (string) $this->config->get('plugins.image-crop.copy_name', '{name}-{width}x{height}');
            $stem = strtr($pattern, ['{name}' => $name, '{width}' => (string) $rect['width'], '{height}' => (string) $rect['height']]);
        }

        $stem = preg_replace('/\s+/u', '-', $stem);
        // No dots in the stem: a "name.php.jpg" double extension can be run as
        // PHP by a misconfigured Apache (AddHandler).
        $stem = str_replace('.', '-', (string) $stem);
        $stem = preg_replace('/[^\p{L}\p{N}_-]+/u', '', (string) $stem);
        $stem = trim((string) preg_replace('/-{2,}/', '-', (string) $stem), '-_.');
        if ($stem === '') {
            throw new ValidationException('The new name must contain at least one letter or number.');
        }

        $suffix = $extension !== '' ? '.' . $extension : '';
        $candidate = $stem . $suffix;
        for ($i = 2; file_exists($dir . '/' . $candidate); $i++) {
            $candidate = $stem . '-' . $i . $suffix;
        }

        return $candidate;
    }

    /**
     * Copy the metadata sidecar and keep the copy next to the original in a
     * manually ordered site media folder.
     *
     * @param array{source: string, folder: string, filename: string, file: string} $target
     */
    private function afterCopy(array $target, string $filename): void
    {
        $dir = dirname($target['file']);

        if ($this->config->get('plugins.image-crop.copy_metadata', true)) {
            $meta = $target['file'] . '.meta.yaml';
            if (is_file($meta) && !file_exists($dir . '/' . $filename . '.meta.yaml')) {
                @copy($meta, $dir . '/' . $filename . '.meta.yaml');
            }
        }

        if ($target['source'] === 'site') {
            $orderFile = $dir . '/' . self::MEDIA_ORDER_FILE;
            if (is_file($orderFile)) {
                try {
                    $data = Yaml::parse((string) file_get_contents($orderFile)) ?: [];
                    $order = is_array($data['media_order'] ?? null) ? array_values(array_filter($data['media_order'], 'is_string')) : [];
                    $index = array_search($target['filename'], $order, true);
                    if ($index !== false && !in_array($filename, $order, true)) {
                        array_splice($order, $index + 1, 0, [$filename]);
                        file_put_contents($orderFile, Yaml::dump(['media_order' => $order], 99, 2));
                    }
                } catch (\Throwable $e) {
                    // Ordering is cosmetic: never fail a crop because of it.
                }
            }
        }
    }

    /**
     * Same tags as the API media endpoints, so Admin2 refreshes what it shows.
     *
     * @param array{source: string, route: string|null, folder: string} $target
     * @return list<string>
     */
    private function invalidationTags(array $target, string $mode): array
    {
        if ($target['source'] === 'page') {
            return array_values(array_unique([
                'media:' . ($mode === 'copy' ? 'create' : 'update') . ':pages/' . $target['route'],
                'media:update:pages/' . $target['route'],
                'pages:update:/' . $target['route'],
            ]));
        }

        $folder = $target['folder'] !== '' ? $target['folder'] : '/';

        return array_values(array_unique([
            'media:' . ($mode === 'copy' ? 'create' : 'update') . ':' . $folder,
            'media:update:' . $folder,
            'media:list',
        ]));
    }

    private function thumbnailUrl(string $file, string $mime): ?string
    {
        try {
            $service = ThumbnailService::forGrav($this->grav);
            $thumb = $service->thumbnailFilename($file, $mime);

            return $thumb ? $this->getApiBaseUrl() . '/thumbnails/' . $thumb : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function cropper(): ImageCropper
    {
        return new ImageCropper(
            (int) $this->config->get('plugins.image-crop.max_megapixels', 60),
            (string) $this->config->get('system.images.adapter', 'gd')
        );
    }

    private function reasonMessage(string $reason): string
    {
        switch ($reason) {
            case 'too_large':
                return 'This image is larger than the maximum size allowed for cropping.';
            case 'animated_gif':
                return 'Animated GIF images cannot be cropped (the animation would be lost).';
            case 'format_not_available':
                return 'The server image library cannot write this format.';
            default:
                return 'This file format cannot be cropped.';
        }
    }
}
