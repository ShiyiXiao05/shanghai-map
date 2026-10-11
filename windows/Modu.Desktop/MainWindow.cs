using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow : Window
{
    private readonly MapApi api;
    private readonly LocalStore store;
    private readonly bool demo;
    private readonly string[] args;
    private ExploreMap? active;
    private List<Place> places = [];
    private List<Place> stops = [];
    private Place? selected;
    private string page = "explore", category = "全部", query = "";
    private bool unvisited, writing, mapLoaded, closing;
    private int sort, revision, detailRevision, pageRevision;
    private CancellationTokenSource loadCancellation = new(), detailCancellation = new();
    private readonly Grid root = new(), workspace = new();
    private readonly StackPanel navigation = new(), mapLinks = new(), details = new();
    private readonly ListBox placeList = new() { BorderThickness = new Thickness(0), Background = Brushes.Transparent, HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly ContentControl content = new();
    private readonly TextBlock title = Ui.Text("探索城市", 26, weight: FontWeights.SemiBold), subtitle = Ui.Muted("把想去的地方，变成下一次出发。", 13), status = Ui.Muted("准备就绪", 11), count = Ui.Muted("", 11);
    private readonly TextBox search = Ui.Input("搜索已收藏的地点");
    private readonly Border detailBorder = new();
    private readonly Grid exploreGrid = new();
    private readonly WebView2 mapView = new();
    private readonly Border mapFrame = new();
    private readonly TextBlock mapHint = Ui.Muted("地图服务尚未开启", 11);
    private readonly DispatcherTimer toastTimer = new() { Interval = TimeSpan.FromSeconds(7) };
    private readonly Dictionary<string, (DateTimeOffset Time, List<Photo> Photos, List<Comment> Comments)> mediaCache = [];
    private readonly Dictionary<string, TaskCompletionSource<List<PickedPoint>>> searchRequests = [];
    private DateTimeOffset lastUpdateCheck = DateTimeOffset.MinValue;
    private readonly HashSet<FrameworkElement> dialogControls = [];
    public MainWindow(string[] arguments)
    {
        args = arguments; demo = args.Contains("--demo");
        string? arg(string key) { var i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        api = new MapApi(arg("--server") ?? "https://shanghai-wish-map.onrender.com");
        store = new LocalStore(arg("--data"));
        Title = "魔都 · Explore"; Width = 1460; Height = 950; MinWidth = 1080; MinHeight = 720; WindowStartupLocation = WindowStartupLocation.CenterScreen;
        FontFamily = new FontFamily("Microsoft YaHei UI"); Background = Ui.Brush("#F4F3EF");
        Icon = BitmapFrame.Create(new Uri("pack://application:,,,/Assets/avatar.png"));
        Ui.Resource(this, BackgroundProperty, "Canvas"); Ui.Resource(root, Panel.BackgroundProperty, "Canvas"); ApplyTheme(IsDark());
        BuildShell(); BuildExplore(); SetPage("explore");
        toastTimer.Tick += (_, _) => { status.Text = "就绪 · 数据与手机端同步"; toastTimer.Stop(); };
        Loaded += async (_, _) =>
        {
            if (demo) { LoadDemo(); RenderPlaces(); SelectPlace(places[0]); }
            else { active = store.Settings.Maps.Find(m => m.Code == store.Settings.SelectedCode); places = store.Cached(active?.Code); RenderMaps(); RenderPlaces(); await Reload(); }
            if (args.Contains("--map-preview")) store.Settings.MapConsent = true;
            if (store.Settings.MapConsent && !args.Contains("--no-map")) await InitMap();
            if (args.Contains("--ui-test")) await RunUiChecks();
            if (args.Contains("--functional-ui-test")) await RunFunctionalUiChecks();
            if (arg("--page") is string target) SetPage(target);
            if (args.Contains("--dark")) ApplyTheme(true);
            if (double.TryParse(arg("--width"), out var requestedWidth)) Width = Math.Max(MinWidth, requestedWidth);
            if (double.TryParse(arg("--height"), out var requestedHeight)) Height = Math.Max(MinHeight, requestedHeight);
            if (!demo && !args.Contains("--functional-ui-test")) _ = CheckUpdates(quiet: true);
            if (arg("--screenshot") is string path) { await Task.Delay(store.Settings.MapConsent ? 10000 : 1200); await SaveScreenshot(path); if (args.Contains("--exit")) Close(); }
        };
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += OnSystemThemeChanged;
        Closing += (_, e) => { if (writing) { e.Cancel = true; Notice("操作正在保存，请稍候再关闭"); return; } closing = true; Microsoft.Win32.SystemEvents.UserPreferenceChanged -= OnSystemThemeChanged; loadCancellation.Cancel(); detailCancellation.Cancel(); mapView.Dispose(); api.Dispose(); };
        Activated += (_, _) => { if (!demo && !writing && DateTimeOffset.Now - lastUpdateCheck > TimeSpan.FromMinutes(30)) { lastUpdateCheck = DateTimeOffset.Now; _ = CheckUpdates(quiet: true); } };
        PreviewKeyDown += (_, e) =>
        {
            if (writing) return;
            if (e.Key == Key.F5) { _ = Reload(); e.Handled = true; }
            else if (e.Key == Key.Escape) { CloseDetail(); e.Handled = true; }
            else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.F) { SetPage("explore"); search.Focus(); search.SelectAll(); e.Handled = true; }
            else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.N) { OpenAdd(); e.Handled = true; }
        };
    }
    private void BuildShell()
    {
        root.ColumnDefinitions.Add(new() { Width = new GridLength(216) }); root.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        var rail = new Grid { Background = Ui.Brush("#1D382F") }; rail.RowDefinitions.Add(new() { Height = GridLength.Auto }); rail.RowDefinitions.Add(new()); rail.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var brand = Ui.Column(Ui.Text("魔都", 30, "#F1F2E7", FontWeights.SemiBold), Ui.Text("E X P L O R E", 10, "#AEC3B4"), Ui.Space(26)); brand.Margin = new Thickness(26, 26, 20, 0); rail.Children.Add(brand);
        var railBody = Ui.Column(navigation, Ui.Space(26), Ui.Text("   我的地图", 11, "#8FA99A"), Ui.Space(12), mapLinks); railBody.Margin = new Thickness(14, 0, 14, 0); Grid.SetRow(railBody, 1); rail.Children.Add(new ScrollViewer { Content = railBody, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }); Grid.SetRow(rail.Children[^1], 1);
        var bottom = Ui.Column(Ui.Rule(), Ui.Row(Ui.Avatar(36), Ui.Column(Ui.Text("城市漫游者", 12, "#E1ECE3"), Ui.Text("WINDOWS · 体验版", 9, "#92A99B"))), Ui.Space(18)); bottom.Margin = new Thickness(23, 0, 18, 0); Grid.SetRow(bottom, 2); rail.Children.Add(bottom);
        root.Children.Add(rail);
        workspace.Margin = new Thickness(28, 0, 28, 0); workspace.RowDefinitions.Add(new() { Height = new GridLength(106) }); workspace.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) }); workspace.RowDefinitions.Add(new() { Height = new GridLength(40) }); Grid.SetColumn(workspace, 1); root.Children.Add(workspace);
        var header = new Grid(); header.ColumnDefinitions.Add(new()); header.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); var heading = Ui.Column(title, Ui.Space(3), subtitle); heading.VerticalAlignment = VerticalAlignment.Center; header.Children.Add(heading);
        var actions = Ui.Row(Ui.Quiet("↻  刷新", () => _ = Reload(), "刷新 · F5"), Ui.Button("＋ 标记地点", OpenAdd, true, "标记地点 · Ctrl+N")); actions.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(actions, 1); header.Children.Add(actions); workspace.Children.Add(header);
        Grid.SetRow(content, 1); workspace.Children.Add(content);
        var footer = new DockPanel(); var version = Ui.Muted("魔都 · Explore   /   0.1.0 体验版", 10); DockPanel.SetDock(version, Dock.Right); footer.Children.Add(version); footer.Children.Add(status); footer.VerticalAlignment = VerticalAlignment.Center; Grid.SetRow(footer, 2); workspace.Children.Add(footer);
        Content = root; RenderMaps();
    }
    private void RenderMaps()
    {
        navigation.Children.Clear(); mapLinks.Children.Clear();
        foreach (var (key, label, icon) in new[] { ("explore", "探索城市", "explore"), ("route", "行程规划", "route"), ("memories", "回忆集", "memory"), ("maps", "地图管理", "maps"), ("poster", "分享海报", "poster"), ("trash", "回收站", "trash"), ("settings", "偏好设置", "settings") })
        {
            var row = Ui.Row(Ui.Icon(icon), Ui.Text(label, 13, key == page ? "#FCFCF2" : "#B9CEC0"));
            var button = Ui.Button(label, () => SetPage(key)); button.Content = row; button.HorizontalContentAlignment = HorizontalAlignment.Left; button.Margin = new Thickness(0, 0, 0, 5); button.Background = Ui.Brush(key == page ? "#365B47" : "#1D382F"); button.BorderThickness = new Thickness(0); button.Padding = new Thickness(14, 12, 10, 12); navigation.Children.Add(button);
        }
        MapLink(null, "公共广场"); foreach (var m in store.Settings.Maps) MapLink(m, m.Name);
        var add = Ui.Quiet("＋ 创建 / 加入地图", () => SetPage("maps")); add.Foreground = Ui.Brush("#92BBA1"); add.FontSize = 11; mapLinks.Children.Add(add);
    }
    private void MapLink(ExploreMap? m, string label)
    {
        var b = Ui.Quiet((active?.Code == m?.Code ? "●  " : "○  ") + label, () => _ = SwitchMap(m)); b.Foreground = Ui.Brush(active?.Code == m?.Code ? "#F0F0DE" : "#A0B5A7"); b.FontSize = 12; b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Left;
        var txt = Ui.Text((active?.Code == m?.Code ? "●  " : "○  ") + label, 12, active?.Code == m?.Code ? "#F0F0DE" : "#A0B5A7"); txt.TextTrimming = TextTrimming.CharacterEllipsis; txt.TextWrapping = TextWrapping.NoWrap; b.Content = txt; mapLinks.Children.Add(b);
    }
    private void BuildExplore()
    {
        exploreGrid.ColumnDefinitions.Add(new() { Width = new GridLength(300) }); exploreGrid.ColumnDefinitions.Add(new() { Width = new GridLength(10) }); exploreGrid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); exploreGrid.ColumnDefinitions.Add(new() { Width = new GridLength(0) });
        var listPanel = new Grid(); listPanel.RowDefinitions.Add(new() { Height = GridLength.Auto }); listPanel.RowDefinitions.Add(new()); listPanel.RowDefinitions.Add(new() { Height = GridLength.Auto });
        search.Margin = new Thickness(0, 0, 0, 12); search.ToolTip = "搜索名称、地址或标签 · Ctrl+F"; search.TextChanged += (_, _) => { query = search.Text; RenderPlaces(); };
        var filter = new ComboBox { ItemsSource = new[] { "全部" }.Concat(Rules.Categories), SelectedIndex = 0 }; AutomationProperties.SetName(filter, "分类筛选"); filter.SelectionChanged += (_, _) => { category = filter.SelectedItem?.ToString() ?? "全部"; RenderPlaces(); };
        var order = new ComboBox { ItemsSource = new[] { "最新添加", "按名称", "最想去" }, SelectedIndex = 0, Margin = new Thickness(8, 0, 0, 0) }; AutomationProperties.SetName(order, "地点排序"); order.SelectionChanged += (_, _) => { sort = order.SelectedIndex; RenderPlaces(); };
        var filterGrid = new Grid(); filterGrid.ColumnDefinitions.Add(new()); filterGrid.ColumnDefinitions.Add(new()); filterGrid.Children.Add(filter); Grid.SetColumn(order, 1); filterGrid.Children.Add(order);
        var check = new CheckBox { Content = "只看还没去的" }; check.Checked += (_, _) => { unvisited = true; RenderPlaces(); }; check.Unchecked += (_, _) => { unvisited = false; RenderPlaces(); };
        var top = Ui.Column(Ui.Text("城市收藏夹", 16, weight: FontWeights.SemiBold), Ui.Space(14), search, filterGrid, Ui.Row(check), Ui.Rule(), count, Ui.Space(10)); top.Margin = new Thickness(18, 18, 18, 0); listPanel.Children.Add(top);
        placeList.Padding = new Thickness(10, 0, 10, 12); ScrollViewer.SetCanContentScroll(placeList, true); VirtualizingPanel.SetIsVirtualizing(placeList, true); VirtualizingPanel.SetVirtualizationMode(placeList, VirtualizationMode.Recycling);
        var itemStyle = new Style(typeof(ListBoxItem)); itemStyle.Setters.Add(new Setter(Control.HorizontalContentAlignmentProperty, HorizontalAlignment.Stretch)); itemStyle.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(0))); itemStyle.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(0))); itemStyle.Setters.Add(new Setter(Control.BackgroundProperty, Brushes.Transparent)); placeList.ItemContainerStyle = itemStyle;
        Grid.SetRow(placeList, 1); listPanel.Children.Add(placeList);
        var draw = Ui.Button("↗  随机出发", DrawPlace); draw.Margin = new Thickness(18, 12, 18, 18); Grid.SetRow(draw, 2); listPanel.Children.Add(draw);
        var listCard = Ui.Card(listPanel, new Thickness(0)); exploreGrid.Children.Add(listCard);
        var splitter = new GridSplitter { Width = 6, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Stretch, Background = Brushes.Transparent, ResizeDirection = GridResizeDirection.Columns, ResizeBehavior = GridResizeBehavior.PreviousAndNext }; Grid.SetColumn(splitter, 1); exploreGrid.Children.Add(splitter);
        var mapGrid = new Grid(); mapGrid.RowDefinitions.Add(new() { Height = GridLength.Auto }); mapGrid.RowDefinitions.Add(new()); mapGrid.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var mapTop = Ui.Column(Ui.Text("让好奇心带路。", 23, weight: FontWeights.SemiBold), Ui.Space(3), Ui.Muted("A SMALL JOURNEY, A GOOD DAY.", 10)); mapTop.Margin = new Thickness(24, 22, 24, 18); mapGrid.Children.Add(mapTop);
        mapFrame.Child = Ui.Column(Ui.Space(60), Ui.Text("城市有很多种打开方式", 20, weight: FontWeights.SemiBold), Ui.Space(12), Ui.Muted("开启地图，让每一个收藏都有方向。", 13), Ui.Space(20), Ui.Button("开启地图服务", () => _ = ConsentMap(), true)); mapFrame.Padding = new Thickness(30); mapFrame.Background = Ui.Brush("#E7ECE2"); Grid.SetRow(mapFrame, 1); mapGrid.Children.Add(mapFrame);
        var mapBottom = new DockPanel { Margin = new Thickness(16, 12, 16, 12) }; var mapActions = Ui.Row(Ui.Quiet("◎ 全部", () => _ = MapScript("window.fitPlaces()")), Ui.Quiet("⌾ 附近", () => _ = Locate()), Ui.Quiet("＋ 选点", () => _ = PickOnMap()), Ui.Quiet("⤢", ToggleMapFocus, "聚焦地图 / 恢复布局")); DockPanel.SetDock(mapActions, Dock.Right); mapBottom.Children.Add(mapActions); mapHint.VerticalAlignment = VerticalAlignment.Center; mapBottom.Children.Add(mapHint); Grid.SetRow(mapBottom, 2); mapGrid.Children.Add(mapBottom);
        var mapCard = Ui.Card(mapGrid, new Thickness(0)); Grid.SetColumn(mapCard, 2); exploreGrid.Children.Add(mapCard);
        detailBorder.Child = new ScrollViewer { Content = details }; detailBorder.Padding = new Thickness(22); detailBorder.Margin = new Thickness(12, 0, 0, 0); detailBorder.CornerRadius = new CornerRadius(18); Ui.Resource(detailBorder, Border.BackgroundProperty, "Surface"); Ui.Resource(detailBorder, Border.BorderBrushProperty, "Line"); detailBorder.BorderThickness = new Thickness(1); Grid.SetColumn(detailBorder, 3); exploreGrid.Children.Add(detailBorder); detailBorder.Visibility = Visibility.Collapsed;
    }
    private void RenderPlaces()
    {
        placeList.Items.Clear(); var filtered = Rules.Filter(places, query, category, unvisited, sort).ToList();
        count.Text = $"{filtered.Count:00} 个地点   /   {places.Count(p => p.Visited):00} 个足迹";
        if (filtered.Count == 0) placeList.Items.Add(Ui.Column(Ui.Space(30), Ui.Muted(places.Count == 0 ? "这里还没有地点。\n创建或加入地图，开始你的城市收藏。" : "没有符合筛选的地点。\n试试其他关键词或分类。"), Ui.Space(15), Ui.Button("创建 / 加入地图", () => SetPage("maps"))));
        foreach (var p in filtered)
        {
            var icon = Ui.Text(p.DisplayEmoji, 25); icon.Width = 42; icon.VerticalAlignment = VerticalAlignment.Center;
            var text = Ui.Column(Ui.Text(p.Name, 14, weight: FontWeights.SemiBold), Ui.Space(4), Ui.Muted(p.Category + (p.Visited ? " · 已去过" : " · 待出发"), 11), Ui.Space(3), Ui.Muted(p.Address, 10));
            var cardGrid = new Grid(); cardGrid.ColumnDefinitions.Add(new() { Width = new GridLength(47) }); cardGrid.ColumnDefinitions.Add(new()); cardGrid.Children.Add(icon); Grid.SetColumn(text, 1); cardGrid.Children.Add(text);
            var button = Ui.Button(p.Name, () => SelectPlace(p)); button.Content = cardGrid; button.Padding = new Thickness(14, 14, 12, 14); button.Margin = new Thickness(0, 0, 0, 7); button.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            if (selected?.Id == p.Id) { Ui.Resource(button, Button.BackgroundProperty, "Tint"); button.BorderBrush = Ui.Brush("#B4C8B4"); }
            placeList.Items.Add(button);
        }
        _ = MapScript($"window.renderPlaces({JsonSerializer.Serialize(filtered, Wire.Json)},{(selected?.Id.ToString() ?? "null")})");
        if (page == "explore") subtitle.Text = $"{active?.Name ?? "公共广场"}  /  把想去的地方，变成下一次出发。";
    }
    private async Task Reload()
    {
        if (demo) { RenderPlaces(); Notice("设计预览：使用隔离的演示数据"); return; }
        var stamp = ++revision; loadCancellation.Cancel(); loadCancellation.Dispose(); loadCancellation = new(); var ct = loadCancellation.Token; var code = active?.Code;
        status.Text = "正在同步，已有地点仍可浏览…";
        try
        {
            var next = await api.Places(code, ct: ct); if (stamp != revision || closing) return;
            places = next; store.Cache(code, next); if (selected != null) selected = places.Find(p => p.Id == selected.Id); RenderPlaces();
            if (active != null) { var map = await api.Map(code!, ct); if (stamp != revision) return; active = map; store.Remember(map); RenderMaps(); }
            if (page != "explore") await RenderPage(); else if (selected != null) SelectPlace(selected);
            Notice("同步完成 · 数据与手机端一致");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception e) { if (stamp == revision) { Notice("同步失败，保留已有内容 · " + Error(e)); } }
    }
    private async Task SwitchMap(ExploreMap? map)
    {
        if (writing) { Notice("请等待当前保存完成"); return; }
        active = map; store.Settings.SelectedCode = map?.Code; store.Save(); CloseDetail(); stops = []; places = store.Cached(map?.Code); search.Text = ""; SetPage("explore"); RenderPlaces(); await MapScript("initial=true;window.renderRoute([])"); await Reload();
    }
    private void SetPage(string next)
    {
        if (writing) { Notice("请等待当前保存完成"); return; }
        page = next; pageRevision++; detailCancellation.Cancel(); detailRevision++; CloseDetail();
        var names = new Dictionary<string, (string, string)> { ["explore"] = ("探索城市", "把想去的地方，变成下一次出发。"), ["route"] = ("行程规划", "串起喜欢的地方，把一天留给城市。"), ["memories"] = ("回忆集", "你走过的每一站，都值得被记住。"), ["maps"] = ("地图管理", "一个邀请码，一起探索的默契。"), ["trash"] = ("回收站", "删除的地点保留 30 天，可以随时找回。"), ["poster"] = ("分享海报", "把城市故事，带给下一位同行者。"), ["settings"] = ("偏好设置", "让每一次使用，都更贴近你。") };
        (title.Text, subtitle.Text) = names[next]; RenderMaps(); if (next == "explore") { content.Content = exploreGrid; RenderPlaces(); } else _ = RenderPage();
    }
    private async Task RunWrite(Func<Task> work, string success = "已保存", Action? rollback = null)
    {
        if (writing) { Notice("当前操作正在保存，请稍候"); return; }
        if (demo) { Notice("设计预览模式不会写入真实数据"); return; }
        writing = true; root.IsEnabled = false; foreach (var frame in dialogControls) frame.IsEnabled = false; status.Text = "正在保存…"; try { await work(); Notice(success); } catch (Exception e) { rollback?.Invoke(); Notice(Error(e)); } finally { writing = false; root.IsEnabled = true; foreach (var frame in dialogControls) frame.IsEnabled = true; }
    }
    private static string Error(Exception e) => e is TaskCanceledException ? "连接超时，请重试；提交前请先刷新确认结果" : e is System.Net.Http.HttpRequestException ? "连接失败，请检查网络后重试" : e.Message;
    private void Notice(string text) { status.Text = text; toastTimer.Stop(); toastTimer.Start(); }
    private void UpdatePlace(Place p) { var index = places.FindIndex(x => x.Id == p.Id); if (index >= 0) places[index] = p; else places.Insert(0, p); if (selected?.Id == p.Id) selected = p; store.Cache(active?.Code, places); RenderPlaces(); }
    private bool RequireMap() { if (active != null) return true; Notice("公共广场仅供浏览，请先创建或加入地图"); SetPage("maps"); return false; }
    private bool RequireNickname() { if (!string.IsNullOrWhiteSpace(store.Settings.Nickname)) return true; NicknameDialog(); return !string.IsNullOrWhiteSpace(store.Settings.Nickname); }
    private static void OpenUrl(Uri uri) { if (uri.Scheme is not ("https" or "http")) throw new ArgumentException("链接格式不受支持"); Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
    private void Copy(string text) { try { Clipboard.SetText(text); Notice("已复制到剪贴板"); } catch (Exception e) { Notice("复制失败 · " + e.Message); } }
    private bool IsDark() { if (store.Settings.ThemeMode != "system") return store.Settings.ThemeMode == "dark"; try { return (int?)Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) == 0; } catch { return false; } }
    private void OnSystemThemeChanged(object sender, Microsoft.Win32.UserPreferenceChangedEventArgs e) { if (store.Settings.ThemeMode == "system" && !closing) _ = Dispatcher.BeginInvoke(() => ApplyTheme(IsDark())); }
    private void ApplyTheme(bool dark) { var colors = dark ? new[] { "#18241F", "#23352D", "#F0F2E8", "#A9B7AA", "#3A4C40", "#304337", "#557E65" } : new[] { "#F4F3EF", "#FFFFFF", "#203A33", "#78837C", "#E4E8E1", "#EDF3EB", "#345E4F" }; string[] keys = ["Canvas", "Surface", "Ink", "Muted", "Line", "Tint", "Accent"]; for (int i = 0; i < keys.Length; i++) Application.Current.Resources[keys[i]] = Ui.Brush(colors[i]); _ = MapScript("window.setTheme(" + (dark ? "true" : "false") + ")"); }
    private async Task SaveScreenshot(string path) { UpdateLayout(); var bitmap = new RenderTargetBitmap((int)root.ActualWidth, (int)root.ActualHeight, 96, 96, PixelFormats.Pbgra32); bitmap.Render(root); if (mapLoaded && mapView.ActualWidth > 0) { using var stream = new MemoryStream(); await mapView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream); stream.Position = 0; var mapBitmap = new BitmapImage(); mapBitmap.BeginInit(); mapBitmap.CacheOption = BitmapCacheOption.OnLoad; mapBitmap.StreamSource = stream; mapBitmap.EndInit(); var visual = new DrawingVisual(); using (var drawing = visual.RenderOpen()) { drawing.DrawImage(bitmap, new Rect(0, 0, root.ActualWidth, root.ActualHeight)); var origin = mapView.TranslatePoint(new Point(0, 0), root); drawing.DrawImage(mapBitmap, new Rect(origin, new Size(mapView.ActualWidth, mapView.ActualHeight))); } bitmap = new RenderTargetBitmap((int)root.ActualWidth, (int)root.ActualHeight, 96, 96, PixelFormats.Pbgra32); bitmap.Render(visual); await File.WriteAllTextAsync(path + ".map-state.json", await mapView.CoreWebView2.ExecuteScriptAsync("JSON.stringify({ready:!!map,markers:markers.size,document:document.readyState})")); } var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!); using var file = File.Create(path); encoder.Save(file); }
    private void LoadDemo() { active = new("DEMO01", "周末 · 城市漫游"); store.Settings.Nickname = "城市漫游者"; places = [new() { Id = 8, Name = "武康大楼", Category = "景点", Emoji = "🏛️", Lng = 121.435, Lat = 31.203, Address = "徐汇区 · 淮海中路 1850 号", Description = "在街角等一束阳光，慢慢看这座城市。", Tags = "建筑 / 漫步 / 摄影", Wishes = ["阿青", "小林"], Visited = true }, new() { Id = 7, Name = "愚园路的咖啡香", Category = "美食", Emoji = "☕", Lng = 121.439, Lat = 31.223, Address = "静安区 · 愚园路", PriceHint = "¥ 35 / 人" }, new() { Id = 6, Name = "西岸美术馆", Category = "展馆", Lng = 121.464, Lat = 31.174, Address = "徐汇区 · 龙腾大道 2600 号" }, new() { Id = 5, Name = "苏州河畔的晚风", Category = "景点", Emoji = "🌉", Lng = 121.484, Lat = 31.245, Address = "虹口区 · 北苏州路" }, new() { Id = 4, Name = "上生 · 新所", Category = "娱乐", Lng = 121.43, Lat = 31.209, Address = "长宁区 · 延安西路 1262 号" }, new() { Id = 3, Name = "复兴公园", Category = "景点", Emoji = "🌳", Lng = 121.469, Lat = 31.214, Address = "黄浦区 · 雁荡路 105 号", Visited = true }]; RenderMaps(); }
}
