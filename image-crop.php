<?php

namespace Grav\Plugin;

use Composer\Autoload\ClassLoader;
use Grav\Common\Plugin;
use Grav\Plugin\ImageCrop\Controllers\ImageCropController;
use RocketTheme\Toolbox\Event\Event;

/**
 * Image Crop – crop images from the Admin2 media lists.
 *
 * Admin2 only (Grav 2): the plugin has no front-end or classic Admin code.
 *  - PHP side: two API routes registered on the Grav API plugin
 *    (GET /image-crop/info, POST /image-crop/crop).
 *  - Admin2 side: an auto-loaded, button-less "floating widget" script
 *    (admin-next/widgets/image-crop.js) adds a crop icon to the media
 *    lists and opens the crop editor.
 */
class ImageCropPlugin extends Plugin
{
    /** Permission required to see the crop icon and to crop. */
    public const PERMISSION = 'api.media.write';

    /**
     * @return array
     */
    public static function getSubscribedEvents(): array
    {
        return [
            'onPluginsInitialized' => [['autoload', 100000]],
            'onApiRegisterRoutes' => ['onApiRegisterRoutes', 0],
            'onApiFloatingWidgets' => ['onApiFloatingWidgets', 0],
        ];
    }

    /**
     * PSR-4 autoloader for the plugin classes (no Composer dependencies).
     */
    public function autoload(): ClassLoader
    {
        $loader = new ClassLoader();
        $loader->addPsr4('Grav\\Plugin\\ImageCrop\\', __DIR__ . '/classes/');
        $loader->register();

        return $loader;
    }

    /**
     * Register the API routes used by the Admin2 crop editor.
     */
    public function onApiRegisterRoutes(Event $event): void
    {
        $routes = $event['routes'];

        $routes->get('/image-crop/info', [ImageCropController::class, 'info']);
        $routes->get('/image-crop/image', [ImageCropController::class, 'image']);
        $routes->post('/image-crop/crop', [ImageCropController::class, 'crop']);
    }

    /**
     * Load the Admin2 script on every admin screen, without a floating button.
     * Only users allowed to write media receive it.
     */
    public function onApiFloatingWidgets(Event $event): void
    {
        $widgets = $event['widgets'];

        $widgets[] = [
            'id' => 'image-crop',
            'plugin' => 'image-crop',
            'label' => 'Image Crop',
            'icon' => 'crop',
            'autoLoad' => true,
            'showFab' => false,
            'priority' => 0,
            'authorize' => self::PERMISSION,
        ];

        $event['widgets'] = $widgets;
    }
}
