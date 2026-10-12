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
        var personalMap = active; categoryFilter.SelectedIndex = 1; unvisitedFilter.IsChecked = true;
        var publicEntry = navigation.Children.OfType<Button>().Single(b => AutomationProperties.GetName(b) == "公共广场"); publicEntry.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); UpdateLayout();
        Check(active == null && title.Text == "公共广场" && collectionTitle.Text == "广场地点", "Primary navigation opens the public square with its own heading");
        Check(category == "全部" && !unvisited && query == "", "Switching to the square resets private map filters");
        Check(placeList.Items.Count == 4, "Demo public square displays public fixture places"); SelectPlace(places[0]); UpdateLayout();
        Check(!FindChildren<Button>(details).Any(b => AutomationProperties.GetName(b) is "编辑地点" or "发送留言" or "加入行程"), "Public details expose read-only actions");
        await SwitchMap(personalMap); UpdateLayout();
        Check(active?.Code == personalMap?.Code && places.Count == 6, "Returning from public square restores the private map");
        ApplyTheme(true); Check(((SolidColorBrush)Application.Current.Resources["Canvas"]).Color.R < 40, "Dark theme changes semantic palette"); ApplyTheme(false);
        var unnamed = FindChildren<Button>(root).Where(b => string.IsNullOrWhiteSpace(AutomationProperties.GetName(b))).Count(); Check(unnamed == 0, "All action buttons have accessible names");
        var standard = Ui.Button("排版", () => { }); var withIcon = Ui.Action("plus", "排版", () => { });
        Check(standard.FontSize == withIcon.FontSize && FindChildren<TextBlock>(withIcon).All(t => t.FontSize == standard.FontSize), "Text and icon buttons share a font size");
        var iconButton = Ui.IconAction("plus", () => { }, "居中图标"); var glyph = (FrameworkElement)iconButton.Content;
        Check(glyph.HorizontalAlignment == HorizontalAlignment.Center && glyph.VerticalAlignment == VerticalAlignment.Center, "Icon-only controls center their glyphs");
        SetPage("settings"); UpdateLayout(); var cardPairs = FindChildren<Grid>(content).Where(g => g.ColumnDefinitions.Count == 3 && g.Children.OfType<Border>().Count() == 2).ToList();
        Check(cardPairs.Count == 2 && cardPairs.All(g => g.ColumnDefinitions[1].Width.Value == Ui.CardGap), "Settings card columns have consistent 24px gutters"); SetPage("explore");
        foreach (var (name, show) in new (string, Action)[] { ("edit-dialog", () => EditPlace(places[0])), ("add-dialog", OpenAdd), ("history-dialog", ShowHistory) })
        {
            var capture = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) };
            capture.Tick += (_, _) => {
                capture.Stop(); var dialog = Application.Current.Windows.OfType<Window>().FirstOrDefault(w => w.Owner == this && w.IsVisible);
                Check(dialog != null, "Native modal renders: " + name); if (dialog == null) return;
                dialog.UpdateLayout(); var visual = (FrameworkElement)dialog.Content;
                var drawing = new DrawingVisual(); using (var dc = drawing.RenderOpen()) { var rect = new Rect(0, 0, visual.ActualWidth, visual.ActualHeight); dc.DrawRectangle(dialog.Background, null, rect); dc.DrawRectangle(new VisualBrush(visual) { Stretch = Stretch.Fill }, null, rect); }
                var shot = new RenderTargetBitmap((int)Math.Ceiling(visual.ActualWidth), (int)Math.Ceiling(visual.ActualHeight), 96, 96, PixelFormats.Pbgra32); shot.Render(drawing); var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(shot)); using (var outputFile = File.Create(Path.Combine(store.DirectoryPath, name + ".png"))) png.Save(outputFile);
                Check(FindChildren<StackPanel>(visual).Where(p => p.Orientation == Orientation.Horizontal && p.HorizontalAlignment == HorizontalAlignment.Right).All(p => p.Children.OfType<FrameworkElement>().SkipLast(1).All(e => e.Margin.Right == Ui.ControlGap)), "Modal actions retain 12px spacing: " + name);
                dialog.Close();
            };
            capture.Start(); show(); capture.Stop();
        }
        SelectPlace(places[0]); Width = 1100; Height = 760; UpdateLayout(); Check(exploreGrid.ColumnDefinitions[0].Width.Value == 0, "Resizing an open detail panel collapses the list"); SelectPlace(places[0]); Check(exploreGrid.ColumnDefinitions[0].Width.Value == 0, "Compact window prioritizes map and detail"); Width = 1460; Height = 950; UpdateLayout(); Check(exploreGrid.ColumnDefinitions[0].Width.Value > 0, "Enlarging the window restores the place list"); CloseDetail();
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
            await api.Publish(map.Code, p.Id); await SwitchMap(null); Check(active == null && title.Text == "公共广场" && places.Any(x => x.Id == p.Id), "Published place appears in the real public square endpoint");
            SelectPlace(places.Single(x => x.Id == p.Id)); Check(!FindChildren<Button>(details).Any(b => AutomationProperties.GetName(b) == "编辑地点"), "Public square detail hides private editing controls");
            await SwitchMap(map); Check(active?.Code == map.Code && places.Any(x => x.Id == p.Id), "Public-to-private navigation reloads the original map");
            await File.WriteAllLinesAsync(Path.Combine(store.DirectoryPath, "functional-ui-checks.txt"), report);
        }
        finally { await api.Raw("DELETE", $"/api/maps/{map.Code}"); store.Forget(map.Code); active = null; places = []; SetPage("explore"); }
    }
}
