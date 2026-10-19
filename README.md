# Image Crop Plugin for Grav Admin2

Crop images straight from the **Admin2** media lists. A crop icon is added to every image thumbnail; it opens a small editor where you drag the corners (or edges) of a crop frame, then either **replace the original image** or **save a copy** at the new size.
<img width="1191" height="746" alt="grav-plugin-image-crop" src="https://github.com/user-attachments/assets/dcc3ac9f-2fc1-458f-b574-bdf592fa7ed5" />

> Admin2 only: this plugin requires **Grav 2** with the **Admin2** and **API** plugins. It does nothing on the front end and has no classic Admin integration.

## Features

- Crop icon on image thumbnails:
  - page editor → *Page Media* panel (next to *Insert*, *Metadata* and *Delete*);
  - *Media* manager → grid view (top-right corner of the card) and list view (end of the row).
- Crop editor:
  - 8 handles (corners and edges), drag inside the frame to move it, or draw a new frame on the image;
  - aspect ratios: free, original, 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16 (hold <kbd>Shift</kbd> to keep the current proportions);
  - exact width / height in pixels;
  - keyboard: arrows move the frame (<kbd>Shift</kbd> = 10 px), <kbd>Alt</kbd> + arrows resize it, <kbd>Enter</kbd> saves, <kbd>Esc</kbd> closes;
  - follows the Admin2 theme (light / dark, accent colour, font) and language (English, French).
- Save:
  - **copy** (default): named `{name}-{width}x{height}` by default (editable, never overwrites an existing file: `-2`, `-3`… are added), the metadata sidecar (`.meta.yaml`: alt text, title…) is copied too, and in a manually ordered *Media* folder the copy is placed right after the original;
  - **replace**: the original file is overwritten (an explicit, red *Replace image* button).
- Formats: JPEG, PNG (transparency kept), WebP, AVIF and static GIF — whatever the configured Grav image adapter (GD or Imagick) can write. SVG, animated GIF (the animation would be lost) and images above the configured size are refused with a clear message.
- JPEG photos with an EXIF orientation are cropped as they are displayed, and saved upright.
- Admin2 refreshes by itself after saving: the new thumbnail is shown right away, a new copy appears in the list.

## Requirements

- Grav **2.0+**
- [API plugin](https://github.com/getgrav/grav-plugin-api) **1.0.51+**
- [Admin2 plugin](https://github.com/getgrav/grav-plugin-admin2) **2.1+**
- PHP GD (or Imagick) with the formats you want to crop, and the EXIF extension for photo orientation.

## Installation

Download the [latest release](https://github.com/paulmassen/grav-plugin-image-crop/releases/latest), unzip it in `user/plugins` and rename the folder to `image-crop`, or clone the repository:

```bash
cd /your/site/grav/user/plugins
git clone https://github.com/paulmassen/grav-plugin-image-crop.git image-crop
```

Reload Admin2: the crop icon appears on image thumbnails.

## Configuration

Default configuration (`user/plugins/image-crop/image-crop.yaml`), editable in Admin2 → *Plugins* → *Image Crop*:

```yaml
enabled: true
quality: 90                          # JPEG / WebP / AVIF quality (40-100)
copy_name: '{name}-{width}x{height}' # Suggested name of a copy
copy_metadata: true                  # Copy the .meta.yaml sidecar to the copy
max_megapixels: 60                   # Larger images are refused (PHP memory)
```

GD needs about 4 bytes per pixel and image: cropping a 60 MP photo needs roughly 500 MB of PHP memory. Lower `max_megapixels` if your `memory_limit` is tight.

## Permissions

- The crop icon, and the editor script itself, are only sent to users with the **`api.media.write`** permission (the same permission Admin2 requires to upload or delete media).
- Page media also follows the page's own permissions: a page whose frontmatter denies `update` to a user cannot have its images cropped by that user.
- File names and paths are validated like the API plugin does (no `..`, no hidden files, everything resolved inside the page folder or `user://media`), and the name of a copy is sanitised (letters, digits, `-` and `_` only, original extension forced).

## How it works

Admin2 is a SvelteKit application that talks to Grav through the API plugin; plugins extend it with web components. This plugin uses:

| Part | Mechanism |
|------|-----------|
| Admin2 script | `onApiFloatingWidgets` with `autoLoad: true` and `showFab: false`: Admin2 loads `admin-next/widgets/image-crop.js` on every screen without showing a floating button. The script adds the crop icons (a `MutationObserver` watches the media lists) and renders the editor in a Shadow DOM. |
| API routes | `onApiRegisterRoutes` (see below), handled by `classes/Controllers/ImageCropController.php`, which extends the API plugin's `AbstractApiController` (authentication, permissions, page ACL, invalidation headers). |
| Image processing | Grav's own `ImageFile` (GD or Imagick, as set in `system.images.adapter`). The result is written to a temporary file and then renamed over the destination, so a failure never leaves a broken image behind. |
| Refresh | The crop response carries the same `X-Invalidates` tags as the API media endpoints (`media:…`, `pages:update:…`), which Admin2 reacts to. |

### API endpoints

All endpoints require `api.media.write`. A media file is addressed with `source=page&route=<page route>&filename=<file>` or `source=site&path=<path relative to user://media>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/image-crop/info` | Image information for the editor: displayed width/height (EXIF orientation applied), format, whether it can be cropped |
| `GET` | `/api/v1/image-crop/image` | The original image (authenticated, `no-store`) |
| `POST` | `/api/v1/image-crop/crop` | JSON body: the address fields + `x`, `y`, `width`, `height` (displayed pixels), `mode` (`overwrite` or `copy`), `name` (copy only, optional) |

```bash
curl -X POST https://example.com/api/v1/image-crop/crop \
  -H "X-API-Token: …" -H "Content-Type: application/json" \
  -d '{"source":"page","route":"blog/my-post","filename":"hero.jpg","x":120,"y":40,"width":1200,"height":675,"mode":"copy"}'
```

### Event

`onImageCropSaved` is fired after every crop with `mode`, `source`, `page` (page media) or `path` (site media), `original`, `file` (absolute paths) and `rect`.

## Limitations

- Media of Flex Objects (and other non-page objects) is not supported yet: the icon is only added to page media and site media.
- The integration relies on the Admin2 media list markup (thumbnails served from `/thumbnails/…`); a future Admin2 redesign of those lists may require an update of the script.
- Cropping a JPEG re-encodes it (at the configured quality) and removes its EXIF metadata.

## License

MIT – see [LICENSE](LICENSE).
