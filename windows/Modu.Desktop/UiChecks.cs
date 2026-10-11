using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Text.Json;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow
{
    private async Task RunUiChecks()
    {
        var failures = new List<string>(); var result = new List<string>();
        void Check(bool condition, string name) { result.Add($"{(condition ? "PASS" : "FAIL")} {name}"); if (!condition) failures.Add(name); }
        Check(placeList.Items.Count == places.Count, "Native place list contains all fixture places"); Check(detailBorder.Visibility == Visibility.Visible, "Native detail panel opens");
        CloseDetail(); Check(exploreGrid.ColumnDefinitions[3].Width.Value == 0, "Detail panel collapses without taking map space");
        foreach (var target in new[] { "route", "memories", "maps", "poster", "trash", "settings", "explore" }) { SetPage(target); await Task.Delay(100); UpdateLayout(); Check(content.Content is FrameworkElement, "Page renders: " + target); }
        search.Text = "武康"; Check(placeList.Items.Count == 1, "Search filters by place name"); search.Text = "";
        ApplyTheme(true); Check(((SolidColorBrush)Application.Current.Resources["Canvas"]).Color.R < 40, "Dark theme changes semantic palette"); ApplyTheme(false);
        var unnamed = FindChildren<Button>(root).Where(b => string.IsNullOrWhiteSpace(AutomationProperties.GetName(b))).Count(); Check(unnamed == 0, "All action buttons have accessible names");
        Width = 1100; Height = 760; UpdateLayout(); SelectPlace(places[0]); Check(exploreGrid.ColumnDefinitions[0].Width.Value == 0, "Compact window prioritizes map and detail"); CloseDetail(); Width = 1460; Height = 950; UpdateLayout();
        var poster = BuildPoster(); Check(poster.Width == 640 && poster.Height == 820, "Poster has stable export dimensions");
        poster.Measure(new Size(640, 820)); poster.Arrange(new Rect(0, 0, 640, 820)); var render = new RenderTargetBitmap(640, 820, 96, 96, PixelFormats.Pbgra32); render.Render(poster); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(render)); var photoPath = Path.Combine(store.DirectoryPath, "test-photo.png"); using (var file = File.Create(photoPath)) encoder.Save(file);
        var prepared = await Images.Prepare(photoPath); Check(Convert.FromBase64String(prepared.Full[(prepared.Full.IndexOf(',') + 1)..]).Length < 1500000 && Convert.FromBase64String(prepared.Thumb[(prepared.Thumb.IndexOf(',') + 1)..]).Length < 64000, "Native photo compression respects API budgets"); Check((await Images.Load(prepared.Thumb)).PixelWidth <= 320, "Native thumbnail decodes without external codecs");
        if (store.Settings.MapConsent)
        {
            for (int i = 0; i < 40 && !mapLoaded; i++) await Task.Delay(250);
            await Task.Delay(2000);
            var mapState = await mapView.CoreWebView2.ExecuteScriptAsync("JSON.stringify({ready:!!map,markers:markers.size})"); var state = JsonDocument.Parse(JsonSerializer.Deserialize<string>(mapState)!).RootElement;
            Check(state.GetProperty("ready").GetBoolean() && state.GetProperty("markers").GetInt32() == places.Count, "Live map creates one marker per place");
            var points = await SearchMap("武康大楼"); Check(points.Count > 0, "Live AMap POI search returns selectable coordinates");
        }
        var fixtures = Path.Combine(AppContext.BaseDirectory, "image-fixtures"); if (Directory.Exists(fixtures))
        {
            foreach (var fixture in Directory.GetFiles(fixtures, "*.webp")) { var preparedWebp = await Images.Prepare(fixture); Check((await Images.Load(preparedWebp.Thumb)).PixelWidth > 0, "WebP upload converts into supported API image"); }
            var rotated = Path.Combine(fixtures, "rotated.jpg"); if (File.Exists(rotated)) { var rotatedImage = await Images.Prepare(rotated); var decoded = await Images.Load(rotatedImage.Full); Check(decoded.PixelWidth < decoded.PixelHeight, "EXIF camera orientation is applied before upload"); }
        }
        var output = Path.Combine(store.DirectoryPath, "ui-checks.txt"); await File.WriteAllLinesAsync(output, result);
        if (failures.Count > 0) throw new InvalidOperationException("UI regression failures: " + string.Join(", ", failures)); SelectPlace(places[0]); Notice($"原生界面回归通过 · {result.Count} 项");
    }
    private static IEnumerable<T> FindChildren<T>(DependencyObject root) where T : DependencyObject { for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) { var child = VisualTreeHelper.GetChild(root, i); if (child is T item) yield return item; foreach (var descendant in FindChildren<T>(child)) yield return descendant; } }
    private async Task RunFunctionalUiChecks()
    {
        if (!new Uri(api.BaseUrl).IsLoopback) throw new InvalidOperationException("Functional UI tests require an isolated localhost server");
        var report = new List<string>(); void Check(bool condition, string name) { if (!condition) throw new Exception(name); report.Add("PASS " + name); }
        store.Settings.Nickname = "native-ui-test"; var map = await api.Create("Native UI isolated test", store.Settings.Nickname);
        try
        {
            store.Remember(map); await SwitchMap(map); var p = await api.Save(map.Code, new Place { Name = "原生控件测试", Category = "景点", Lng = 121.4, Lat = 31.2, AddedBy = store.Settings.Nickname }, true); UpdatePlace(p); SelectPlace(p); await Task.Delay(100); Check(details.Children.Count > 10, "Real data opens native detail actions");
            await Wish(p); Check(selected?.Wishes.Contains(store.Settings.Nickname) == true, "Native optimistic wish reconciles with server"); await Visit(selected!); Check(selected?.Visited == true, "Native check-in updates selected place");
            for (int i = 0; i < 30 && !commentsReady; i++) await Task.Delay(100); commentInput!.Text = "原生输入框留言"; await SendComment(selected!, commentInput); Check(detailComments.Count == 1 && commentInput.Text == "", "Native comment input submits and clears on success");
            await AddToRoute(selected!); SetPage("route"); await Task.Delay(200); Check(stops.Count == 1, "Native itinerary page reflects persisted stop"); SetPage("memories"); await Task.Delay(200); Check(FindChildren<TextBlock>(content).Any(t => t.Text == "原生控件测试"), "Native memory page displays visited place");
            await api.DeletePlace(map.Code, p.Id); SetPage("trash"); await Task.Delay(200); Check(FindChildren<TextBlock>(content).Any(t => t.Text == "原生控件测试"), "Native trash page renders deleted place"); await api.Restore(map.Code, p.Id); await Reload(); Check(places.Count == 1, "Refresh restores visible data after recovery");
            await File.WriteAllLinesAsync(Path.Combine(store.DirectoryPath, "functional-ui-checks.txt"), report);
        }
        finally { await api.Raw("DELETE", $"/api/maps/{map.Code}"); store.Forget(map.Code); active = null; places = []; SetPage("explore"); }
    }
}
