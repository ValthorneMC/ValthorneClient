use std::io::Cursor;

const PNG_SIGNATURE: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

pub fn is_png(data: &[u8]) -> bool {
    data.starts_with(PNG_SIGNATURE)
}

/// Normalizes a Minecraft skin texture to the modern 64x64 RGBA format, converting legacy
/// 64x32 skins the same way the vanilla client does (mirrored limb backs, "Notch transparency
/// hack" on the outer head layer, and opaque inner parts). Ported from Modrinth App's
/// skin normalization logic (packages/app-lib/src/api/minecraft_skins/png_util.rs).
///
/// Rejects anything that isn't a valid 64x64 or 64x32 PNG, so callers get a clear error
/// instead of an opaque 400 from Mojang's skin upload endpoint.
pub fn normalize_skin_texture(data: &[u8]) -> Result<Vec<u8>, String> {
    if !is_png(data) {
        return Err("El archivo no es un PNG válido".to_string());
    }

    let mut decoder = png::Decoder::new(Cursor::new(data));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("No se pudo leer el PNG: {}", e))?;

    let info = reader.info();
    let width = info.width;
    let height = info.height;
    if width != 64 || (height != 64 && height != 32) {
        return Err(format!(
            "La skin debe medir 64x64 (o 64x32 para skins clásicas antiguas), pero mide {}x{}",
            width, height
        ));
    }
    let is_legacy = height == 32;
    let color_type = info.color_type;

    let output_buffer_size = reader.output_buffer_size();
    let mut raw_buf = vec![0u8; output_buffer_size];
    reader
        .next_frame(&mut raw_buf)
        .map_err(|e| format!("No se pudo decodificar el PNG: {}", e))?;

    // Expand the decoded pixels into a flat 64x64 RGBA buffer, padding the bottom
    // half with transparent pixels for legacy 64x32 skins.
    let mut rgba = vec![0u8; 64 * 64 * 4];
    let src_pixels = (width * height) as usize;
    for i in 0..src_pixels {
        let (r, g, b, a) = match color_type {
            png::ColorType::Grayscale => {
                let v = raw_buf[i];
                (v, v, v, 255)
            }
            png::ColorType::GrayscaleAlpha => {
                let v = raw_buf[i * 2];
                let a = raw_buf[i * 2 + 1];
                (v, v, v, a)
            }
            png::ColorType::Rgb => {
                let o = i * 3;
                (raw_buf[o], raw_buf[o + 1], raw_buf[o + 2], 255)
            }
            png::ColorType::Rgba => {
                let o = i * 4;
                (raw_buf[o], raw_buf[o + 1], raw_buf[o + 2], raw_buf[o + 3])
            }
            _ => return Err("Formato de color de PNG no soportado".to_string()),
        };
        let o = i * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = a;
    }

    if is_legacy {
        convert_legacy_skin_texture(&mut rgba);
        do_notch_transparency_hack(&mut rgba);
    }
    make_inner_parts_opaque(&mut rgba);

    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, 64, 64);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_filter(png::FilterType::NoFilter);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("No se pudo generar el PNG: {}", e))?;
        writer
            .write_image_data(&rgba)
            .map_err(|e| format!("No se pudo generar el PNG: {}", e))?;
    }

    Ok(encoded)
}

fn pixel_index(x: usize, y: usize) -> usize {
    (x + y * 64) * 4
}

fn set_alpha(buf: &mut [u8], x1: usize, y1: usize, x2: usize, y2: usize, alpha: u8) {
    for y in y1..y2 {
        for x in x1..x2 {
            buf[pixel_index(x, y) + 3] = alpha;
        }
    }
}

/// Copies a rectangle of pixels, mirroring them horizontally, from `(x, y)` to
/// `(x + off_x, y + off_y)`. Matches Blaze3D's `NativeImage#copyRect` used by the
/// vanilla client to expand legacy 64x32 skins into the modern 64x64 layout.
#[allow(clippy::too_many_arguments)]
fn copy_rect_mirror_horizontally(
    buf: &mut [u8],
    x: usize,
    y: usize,
    off_x: isize,
    off_y: isize,
    width: usize,
    height: usize,
) {
    for row in 0..height {
        for col in 0..width {
            let src_x = x + col;
            let src_y = y + row;
            let dst_x = (x as isize + off_x) as usize + (width - 1 - col);
            let dst_y = (y as isize + off_y) as usize + row;

            let src = pixel_index(src_x, src_y);
            let dst = pixel_index(dst_x, dst_y);
            let pixel = [buf[src], buf[src + 1], buf[src + 2], buf[src + 3]];
            buf[dst..dst + 4].copy_from_slice(&pixel);
        }
    }
}

/// Converts a legacy 32-pixel-tall skin (already padded into a 64x64 buffer) to the
/// native 64x64 format by mirroring the limb faces into the newly added arm/leg backs.
fn convert_legacy_skin_texture(buf: &mut [u8]) {
    const FACE_COPY_PARAMETERS: &[(usize, usize, isize, isize, usize, usize)] = &[
        (4, 16, 16, 32, 4, 4),
        (8, 16, 16, 32, 4, 4),
        (0, 20, 24, 32, 4, 12),
        (4, 20, 16, 32, 4, 12),
        (8, 20, 8, 32, 4, 12),
        (12, 20, 16, 32, 4, 12),
        (44, 16, -8, 32, 4, 4),
        (48, 16, -8, 32, 4, 4),
        (40, 20, 0, 32, 4, 12),
        (44, 20, -8, 32, 4, 12),
        (48, 20, -16, 32, 4, 12),
        (52, 20, -8, 32, 4, 12),
    ];

    for &(x, y, off_x, off_y, width, height) in FACE_COPY_PARAMETERS {
        copy_rect_mirror_horizontally(buf, x, y, off_x, off_y, width, height);
    }
}

/// Makes the outer head layer transparent if every pixel in it is already mostly opaque,
/// matching the vanilla client's handling of skins exported before that layer existed.
fn do_notch_transparency_hack(buf: &mut [u8]) {
    let (x1, y1, x2, y2) = (32, 0, 64, 32);
    for y in y1..y2 {
        for x in x1..x2 {
            if buf[pixel_index(x, y) + 3] < 128 {
                return;
            }
        }
    }
    set_alpha(buf, x1, y1, x2, y2, 0);
}

/// Forces the head, torso and leg/arm inner parts to be fully opaque, as the vanilla
/// client does when rendering skins.
fn make_inner_parts_opaque(buf: &mut [u8]) {
    const OPAQUE_PART_PARAMETERS: &[(usize, usize, usize, usize)] =
        &[(0, 0, 32, 16), (0, 16, 64, 32), (16, 48, 48, 64)];

    for &(x1, y1, x2, y2) in OPAQUE_PART_PARAMETERS {
        set_alpha(buf, x1, y1, x2, y2, 255);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_solid_png(width: u32, height: u32) -> Vec<u8> {
        let mut data = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut data, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let px = vec![200u8; (width * height * 4) as usize];
            writer.write_image_data(&px).unwrap();
        }
        data
    }

    #[test]
    fn accepts_64x64() {
        let png_data = make_solid_png(64, 64);
        let result = normalize_skin_texture(&png_data).unwrap();
        assert!(is_png(&result));
    }

    #[test]
    fn accepts_legacy_64x32() {
        let png_data = make_solid_png(64, 32);
        let result = normalize_skin_texture(&png_data).unwrap();
        assert!(is_png(&result));
        let mut decoder = png::Decoder::new(std::io::Cursor::new(&result));
        decoder.set_transformations(png::Transformations::normalize_to_color8());
        let reader = decoder.read_info().unwrap();
        assert_eq!(reader.info().width, 64);
        assert_eq!(reader.info().height, 64);
    }

    #[test]
    fn rejects_wrong_dimensions() {
        let png_data = make_solid_png(100, 50);
        let err = normalize_skin_texture(&png_data).unwrap_err();
        assert!(err.contains("64x64"));
    }

    #[test]
    fn rejects_non_png() {
        let err = normalize_skin_texture(b"not a png").unwrap_err();
        assert!(err.contains("PNG"));
    }
}
