using System.IO;
using System.Net.Http;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Modu.Desktop;
internal static class Images
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(35) };
    private static readonly Dictionary<string, BitmapSource> Cache = [];
    public static async Task<BitmapSource> Load(string source, CancellationToken ct = default)
    {
        lock (Cache) { if (Cache.TryGetValue(source, out var cached)) return cached; }
        byte[] bytes;
        if (source.StartsWith("data:image/", StringComparison.Ordinal) && source.Contains(";base64,")) bytes = Convert.FromBase64String(source[(source.IndexOf(',') + 1)..]);
        else { var uri = new Uri(source); if (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) throw new ArgumentException("图片链接格式不受支持"); using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct); response.EnsureSuccessStatusCode(); if (response.Content.Headers.ContentLength > 20 * 1024 * 1024) throw new ArgumentException("图片过大"); using var stream = await response.Content.ReadAsStreamAsync(ct); using var data = new MemoryStream(); byte[] buffer = new byte[16384]; int n; while ((n = await stream.ReadAsync(buffer, ct)) > 0) { if (data.Length + n > 20 * 1024 * 1024) throw new ArgumentException("图片过大"); data.Write(buffer, 0, n); } bytes = data.ToArray(); }
        var bitmap = await Task.Run(() => Decode(bytes), ct); lock (Cache) { if (Cache.Count >= 80) Cache.Clear(); Cache[source] = bitmap; }
        return bitmap;
    }
    private static BitmapSource Decode(byte[] bytes, int max = 1800)
    {
        using var data = SkiaSharp.SKData.CreateCopy(bytes); using var codec = SkiaSharp.SKCodec.Create(data) ?? throw new ArgumentException("无法读取这张照片");
        if ((long)codec.Info.Width * codec.Info.Height > 80_000_000) throw new ArgumentException("图片尺寸过大，请先缩小图片");
        var info = codec.Info.WithColorType(SkiaSharp.SKColorType.Bgra8888).WithAlphaType(SkiaSharp.SKAlphaType.Premul);
        using var decoded = new SkiaSharp.SKBitmap(info); var result = codec.GetPixels(info, decoded.GetPixels()); if (result != SkiaSharp.SKCodecResult.Success) throw new ArgumentException("照片文件不完整或格式不受支持");
        using var skImage = SkiaSharp.SKImage.FromBitmap(decoded); using var png = skImage.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100); using var stream = new MemoryStream(png.ToArray());
        var bitmap = new BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.StreamSource = stream; bitmap.EndInit(); BitmapSource source = bitmap;
        var orientation = (int)codec.EncodedOrigin; var transform = new TransformGroup();
        if (orientation is 2 or 5 or 7) transform.Children.Add(new ScaleTransform(-1, 1));
        if (orientation == 4) transform.Children.Add(new ScaleTransform(1, -1));
        if (orientation == 3) transform.Children.Add(new RotateTransform(180));
        if (orientation is 5 or 6) transform.Children.Add(new RotateTransform(90));
        if (orientation is 7 or 8) transform.Children.Add(new RotateTransform(270));
        if (transform.Children.Count > 0) source = new TransformedBitmap(source, transform);
        var scale = Math.Min(1, (double)max / Math.Max(source.PixelWidth, source.PixelHeight)); if (scale < 1) source = new TransformedBitmap(source, new ScaleTransform(scale, scale)); source.Freeze(); return source;
    }
    public static async Task<(string Full, string Thumb)> Prepare(string path) => await Task.Run(() =>
    {
        var file = new FileInfo(path); if (file.Length > 50 * 1024 * 1024) throw new ArgumentException("原图需小于 50 MB"); var bytes = File.ReadAllBytes(path); var image = Decode(bytes, 1600);
        string Encode(BitmapSource source, int max, int budget) { var scale = Math.Min(1, (double)max / Math.Max(source.PixelWidth, source.PixelHeight)); if (scale < 1) source = new TransformedBitmap(source, new ScaleTransform(scale, scale)); for (int quality = 88; quality >= 28; quality -= 10) { var encoder = new JpegBitmapEncoder { QualityLevel = quality }; encoder.Frames.Add(BitmapFrame.Create(source)); using var output = new MemoryStream(); encoder.Save(output); if (output.Length <= budget) return "data:image/jpeg;base64," + Convert.ToBase64String(output.ToArray()); } throw new ArgumentException("图片压缩后仍过大，请先缩小图片"); }
        using var pngStream = new MemoryStream(); var pngEncoder = new PngBitmapEncoder(); pngEncoder.Frames.Add(BitmapFrame.Create(image)); pngEncoder.Save(pngStream);
        string full = pngStream.Length <= 1_500_000 ? "data:image/png;base64," + Convert.ToBase64String(pngStream.ToArray()) : Encode(image, 1600, 1_500_000);
        return (full, Encode(image, 320, 62_000));
    });
}
