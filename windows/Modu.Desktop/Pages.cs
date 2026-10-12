using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow
{
    private async Task RenderPage()
    {
        var target = page; var stamp = revision; var pageStamp = ++pageRevision; var body = new StackPanel { Margin = new Thickness(32), MaxWidth = 1030, HorizontalAlignment = HorizontalAlignment.Stretch }; var scroll = new ScrollViewer { Content = body }; content.Content = Ui.Card(scroll, new Thickness(0));
        if (target == "maps") { RenderMapManagement(body); return; }
        if (target == "settings") { RenderSettings(body); return; }
        if (target == "poster") { RenderPosterPage(body); return; }
        if (active == null) { body.Children.Add(Ui.Text("先拥有一张属于你的地图", 24, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Space(12)); body.Children.Add(Ui.Muted("公共广场可以浏览。行程、回忆和回收站属于你加入的地图。")); body.Children.Add(Ui.Space(22)); body.Children.Add(Ui.Button("创建 / 加入地图", () => SetPage("maps"), true)); return; }
        var code = active.Code; var loading = Ui.Muted("正在加载…"); body.Children.Add(loading);
        try
        {
            if (target == "route")
            {
                var next = demo ? places.Take(3).ToList() : await api.Itinerary(code, loadCancellation.Token); if (page != target || revision != stamp || pageStamp != pageRevision) return; stops = next; body.Children.Clear(); RenderRoute(body);
            }
            else if (target == "trash")
            {
                var next = demo ? new List<Place>() : await api.Places(code, true, loadCancellation.Token); if (page != target || revision != stamp || pageStamp != pageRevision) return; body.Children.Clear(); body.Children.Add(Ui.Text("留一点反悔的余地。", 24, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Space(8)); body.Children.Add(Ui.Muted("删除超过 30 天的地点会被清理。恢复时会一并找回照片、留言和行程关联。")); body.Children.Add(Ui.Space(24));
                foreach (var p in next) {
                    var b = new Grid(); b.ColumnDefinitions.Add(new() { Width = new GridLength(64) }); b.ColumnDefinitions.Add(new()); b.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
                    var symbol = Ui.PlaceSymbol(p, 48); symbol.HorizontalAlignment = HorizontalAlignment.Left; b.Children.Add(symbol);
                    var info = Ui.Column(Ui.Text(p.Name, Ui.SectionSize, weight: FontWeights.SemiBold), Ui.Space(4), Ui.Muted(p.DeletedAt?.Length >= 10 ? $"删除于 {p.DeletedAt[..10]}" : "最近删除")); info.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(info, 1); b.Children.Add(info);
                    var restore = Ui.Button("恢复地点", () => _ = RunWrite(async () => { await api.Restore(code, p.Id); UpdatePlace(p with { DeletedAt = null }); await RenderPage(); }, "地点已恢复")); restore.Margin = new Thickness(24, 0, 0, 0); restore.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(restore, 2); b.Children.Add(restore); body.Children.Add(Ui.Card(b)); body.Children.Add(Ui.Space(24));
                }
                if (next.Count == 0) body.Children.Add(Ui.Muted("回收站是空的。每一个收藏都好好留着。", 14));
            }
            else if (target == "memories")
            {
                var next = demo ? places.Where(p => p.Visited).Select(p => new Memory(p.Id, p.Name, p.Category, p.Address, "2026-10-12", [])).ToList() : await api.Memories(code, loadCancellation.Token); if (page != target || revision != stamp || pageStamp != pageRevision) return; body.Children.Clear(); body.Children.Add(Ui.Text("走过的路，会留下光。", 28, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Space(8)); body.Children.Add(Ui.Muted($"{next.Count} 个足迹 · {active.Name}")); body.Children.Add(Ui.Space(26));
                foreach (var m in next)
                {
                    var heading = Ui.Row(Ui.Text(Rules.Emoji(m.Category), 26), Ui.Column(Ui.Text(m.Name, 18, weight: FontWeights.SemiBold), Ui.Muted(m.VisitedAt?.Length >= 10 ? m.VisitedAt[..10] : "一段城市回忆", 11))); var card = Ui.Column(heading, Ui.Space(10), Ui.Muted(m.Address)); var photos = new WrapPanel(); card.Children.Add(photos);
                    foreach (var source in (m.Photos ?? []).Take(6)) { var image = new System.Windows.Controls.Image { Width = 170, Height = 125, Stretch = Stretch.UniformToFill, Margin = new Thickness(0, 12, 10, 0) }; photos.Children.Add(image); _ = Load(); async Task Load() { try { image.Source = await Images.Load(source); } catch { image.ToolTip = "照片加载失败"; } } }
                    var revisit = Ui.Quiet("回到这个地点 ↗", () => { if (places.Find(p => p.Id == m.Id) is Place p) SelectPlace(p); }); revisit.HorizontalAlignment = HorizontalAlignment.Left; revisit.Margin = new Thickness(0, 12, 0, 0); card.Children.Add(revisit); body.Children.Add(Ui.Card(card)); body.Children.Add(Ui.Space(24));
                }
                if (next.Count == 0) body.Children.Add(Ui.Muted("还没有足迹。给去过的地点打卡，它就会成为这里的回忆。", 14));
            }
        }
        catch (OperationCanceledException) when (loadCancellation.IsCancellationRequested) { }
        catch (Exception e) { if (page != target || pageStamp != pageRevision) return; body.Children.Clear(); body.Children.Add(Ui.Text("这次没能加载完成", 22)); body.Children.Add(Ui.Space(10)); body.Children.Add(Ui.Muted(Error(e))); body.Children.Add(Ui.Space(20)); body.Children.Add(Ui.Button("重试", () => _ = RenderPage(), true)); }
    }
    private void RenderRoute(StackPanel body)
    {
        var intro = Ui.Column(Ui.Text("把喜欢串成一条路。", 27, weight: FontWeights.SemiBold), Ui.Space(8), Ui.Muted(Rules.RouteText(stops), 14), Ui.Space(8), Ui.Muted("距离为相邻地点直线距离之和；步行时间按 4.5 km/h 估算。请以高德实际路线为准。", 11)); body.Children.Add(intro); body.Children.Add(Ui.Space(18));
        body.Children.Add(Ui.Wrap(Ui.Button("复制行程", () => Copy($"《{active?.Name}》行程单\n" + string.Join("\n", stops.Select((p, i) => $"{i + 1}. {p.Name} · {p.Address}")))), Ui.Button("高德步行路线 ↗", OpenRoute, true), Ui.Button("清空行程", () => { if (stops.Count > 0 && Confirm("清空当前行程？", "只清空行程，收藏的地点会保留。")) _ = SaveRoute([]); }))); body.Children.Add(Ui.Space(24));
        for (int i = 0; i < stops.Count; i++)
        {
            var index = i; var p = stops[i]; var card = new Grid(); card.ColumnDefinitions.Add(new() { Width = new GridLength(52) }); card.ColumnDefinitions.Add(new()); card.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); var number = Ui.Text($"{i + 1:00}", 26, "#93A18D", FontWeights.SemiBold); number.VerticalAlignment = VerticalAlignment.Center; card.Children.Add(number); var info = Ui.Column(Ui.Text(p.Name, 16, weight: FontWeights.SemiBold), Ui.Space(3), Ui.Muted(p.Address, 12)); Grid.SetColumn(info, 1); card.Children.Add(info);
            var up = Ui.Quiet("↑", () => { var ids = stops.Select(x => x.Id).ToList(); (ids[index], ids[index - 1]) = (ids[index - 1], ids[index]); _ = SaveRoute(ids); }, "上移"); up.IsEnabled = i > 0; var down = Ui.Quiet("↓", () => { var ids = stops.Select(x => x.Id).ToList(); (ids[index], ids[index + 1]) = (ids[index + 1], ids[index]); _ = SaveRoute(ids); }, "下移"); down.IsEnabled = i < stops.Count - 1;
            var controls = Ui.Row(up, down, Ui.Quiet("×", () => _ = SaveRoute(stops.Where(x => x.Id != p.Id).Select(x => x.Id).ToList()), "移出行程")); controls.Margin = new Thickness(16, 0, 0, 0); Grid.SetColumn(controls, 2); card.Children.Add(controls); body.Children.Add(Ui.Card(card)); body.Children.Add(Ui.Space(16));
        }
        if (stops.Count == 0) body.Children.Add(Ui.Muted("从下面选几个地点，开始规划你的下一次出发。", 14)); body.Children.Add(Ui.Space(26)); body.Children.Add(Ui.Text("加入更多地点", 17, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Space(12)); var available = new WrapPanel(); body.Children.Add(available);
        foreach (var p in places.Where(p => stops.All(x => x.Id != p.Id))) { var b = Ui.Button($"＋ {p.DisplayEmoji} {p.Name}", () => _ = AddToRoute(p)); b.Margin = new Thickness(0, 0, 10, 10); available.Children.Add(b); }
    }
    private async Task AddToRoute(Place p)
    {
        if (writing || !RequireMap()) return; var code = active!.Code;
        await RunWrite(async () => { var current = await api.Itinerary(code); if (current.Any(x => x.Id == p.Id)) { Notice("这个地点已在行程中"); return; } if (current.Count >= 50) throw new InvalidOperationException("行程最多 50 个地点"); stops = await api.SaveItinerary(code, current.Select(x => x.Id).Append(p.Id).ToList()); if (page == "route") await RenderPage(); }, "已加入行程");
    }
    private async Task SaveRoute(List<long> ids)
    {
        if (writing || active == null) return; var code = active.Code; await RunWrite(async () => { stops = await api.SaveItinerary(code, ids); await RenderPage(); }, "行程已保存");
    }
    private void OpenRoute()
    {
        if (stops.Count < 2) { Notice("需要至少两个地点才能规划路线"); return; }
        if (stops.Count == 2) { OpenUrl(Rules.RouteNavigation(stops[0], stops[1])); return; }
        var (w, body, footer) = Dialog("按行程逐段导航", "高德步行规划按两个端点计算。选择一段路线，完整行程顺序会保留。", 650);
        for (int i = 0; i < stops.Count - 1; i++) { var a = stops[i]; var b = stops[i + 1]; body.Children.Add(Ui.Button($"{i + 1:00}  {a.Name}  →  {b.Name}   ↗", () => OpenUrl(Rules.RouteNavigation(a, b)))); body.Children.Add(Ui.Space(10)); }
        w.ShowDialog();
    }
    private void RenderMapManagement(StackPanel body)
    {
        var hero = Ui.Column(Ui.Text("和谁出发，都有一张地图。", 27, weight: FontWeights.SemiBold), Ui.Space(8), Ui.Muted("创建新的城市收藏，或者用邀请码加入朋友的地图。", 13), Ui.Space(24), Ui.Wrap(Ui.Button("＋ 创建地图", CreateMapDialog, true), Ui.Button("输入邀请码加入", JoinMapDialog))); body.Children.Add(hero); body.Children.Add(Ui.Space(28));
        if (active != null) { body.Children.Add(Ui.Text("当前地图", 12, "#829079")); body.Children.Add(Ui.Space(12)); var card = Ui.Column(Ui.Text(active.Name, 22, weight: FontWeights.SemiBold), Ui.Space(8), Ui.Muted($"邀请码  {active.Code}  ·  {places.Count} 个收藏", 13), Ui.Space(20), Ui.Wrap(Ui.Button("复制邀请链接", () => Copy($"一起探索《{active.Name}》\n{api.BaseUrl}/?map={active.Code}\n邀请码：{active.Code}")), Ui.Button("修改名称", RenameMapDialog), Ui.Button("导出 JSON", () => _ = ExportMap()), Ui.Button("更换邀请码", () => _ = RekeyMap()), Ui.Button("分享海报", () => SetPage("poster")), Ui.Button("删除地图", () => _ = DeleteMap()))); body.Children.Add(Ui.Card(card)); body.Children.Add(Ui.Space(24)); }
        body.Children.Add(Ui.Text("已加入的地图", 18, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Space(12));
        foreach (var m in store.Settings.Maps) { var row = new Grid(); row.ColumnDefinitions.Add(new()); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.Children.Add(Ui.Column(Ui.Text(m.Name, 17, weight: FontWeights.SemiBold), Ui.Space(4), Ui.Muted("邀请码 " + m.Code))); var actions = Ui.Row(Ui.Button("打开地图", () => _ = SwitchMap(m), true), Ui.Quiet("从本机移除", () => { if (writing || !Confirm("从本机移除地图？", "不会删除服务器数据，以后可以用邀请码重新加入。")) return; store.Forget(m.Code); if (active?.Code == m.Code) _ = SwitchMap(null); else { RenderMaps(); _ = RenderPage(); } })); actions.Margin = new Thickness(24, 0, 0, 0); Grid.SetColumn(actions, 1); row.Children.Add(actions); body.Children.Add(Ui.Card(row)); body.Children.Add(Ui.Space(24)); }
        if (store.Settings.Maps.Count == 0) body.Children.Add(Ui.Muted("还没有加入地图。开始你的第一份城市收藏吧。", 14));
    }
    private void CreateMapDialog() { if (!RequireNickname()) return; var (w, body, footer) = Dialog("创建一张地图", "给这次探索起个名字。", 520); var input = Ui.Input("地图名称", max: 40); var error = Ui.Text("", 12, "#B35D4C"); body.Children.Add(Ui.Field("地图名称 · 最多 40 字", input)); body.Children.Add(error); footer.Children.Add(Ui.Button("创建地图", () => _ = RunWrite(async () => { if (string.IsNullOrWhiteSpace(input.Text)) throw new ArgumentException("地图名称不能为空"); try { var m = await api.Create(input.Text.Trim(), store.Settings.Nickname); store.Remember(m); _ = Dispatcher.BeginInvoke(async () => { w.DialogResult = true; await SwitchMap(m); }); } catch (Exception e) { error.Text = Error(e); throw; } }, "地图已创建"), true)); w.ShowDialog(); }
    private void JoinMapDialog() { var (w, body, footer) = Dialog("加入朋友的地图", "输入 6 位邀请码，收藏和回忆就会同步。", 510); var input = Ui.Input("6 位邀请码", max: 6); var error = Ui.Text("", 12, "#B35D4C"); body.Children.Add(Ui.Field("邀请码", input)); body.Children.Add(error); footer.Children.Add(Ui.Button("加入地图", () => _ = RunWrite(async () => { var code = Rules.Code(input.Text); if (code == null) { error.Text = "邀请码需要 6 位英文字母或数字"; throw new ArgumentException(error.Text); } try { var m = await api.Map(code); store.Remember(m); _ = Dispatcher.BeginInvoke(async () => { w.DialogResult = true; await SwitchMap(m); }); } catch (Exception e) { error.Text = Error(e); throw; } }, "已加入地图"), true)); w.ShowDialog(); }
    private void RenameMapDialog() { if (active == null) return; var map = active; var (w, body, footer) = Dialog("修改地图名称", width: 510); var input = Ui.Input("地图名称", map.Name, 40); var error = Ui.Text("", 12, "#B35D4C"); body.Children.Add(Ui.Field("地图名称", input)); body.Children.Add(error); footer.Children.Add(Ui.Button("保存名称", () => _ = RunWrite(async () => { try { if (string.IsNullOrWhiteSpace(input.Text)) throw new ArgumentException("地图名称不能为空"); active = await api.Write<ExploreMap>("PUT", $"/api/maps/{map.Code}", new { name = input.Text.Trim() }); store.Remember(active); RenderMaps(); await RenderPage(); _ = Dispatcher.BeginInvoke(() => w.Close()); } catch (Exception e) { error.Text = Error(e); throw; } }, "地图已改名"), true)); w.ShowDialog(); }
    private async Task ExportMap() { if (active == null) return; var code = active.Code; var picker = new SaveFileDialog { Filter = "JSON 备份|*.json", FileName = $"modu-map-{code}.json" }; if (picker.ShowDialog(this) != true) return; try { var data = await api.Raw("GET", $"/api/maps/{code}/export"); await File.WriteAllTextAsync(picker.FileName, data); Notice("地图已导出"); } catch (Exception e) { Notice(Error(e)); } }
    private async Task RekeyMap() { if (writing || active == null || !Confirm("更换邀请码？", "旧邀请码会立即失效，朋友需要使用新码重新加入。")) return; var old = active; await RunWrite(async () => { active = await api.Write<ExploreMap>("POST", $"/api/maps/{old.Code}/rekey"); store.Remember(active, old.Code); mediaCache.Clear(); store.Cache(active.Code, places); RenderMaps(); await RenderPage(); }, "邀请码已更换，请分享新码"); }
    private async Task DeleteMap() { if (writing || active == null || !Confirm("永久删除这张地图？", "地图、地点、照片和留言都会永久删除，无法恢复。")) return; var old = active; await RunWrite(async () => { await api.Raw("DELETE", $"/api/maps/{old.Code}"); store.Forget(old.Code); active = null; places = store.Cached(null); CloseDetail(); mediaCache.Clear(); RenderMaps(); RenderPlaces(); await RenderPage(); }, "地图已删除"); }
    private void RenderPosterPage(StackPanel body)
    {
        if (active == null) { body.Children.Add(Ui.Muted("创建或加入地图后，可以生成你的分享海报。", 15)); body.Children.Add(Ui.Button("前往地图管理", () => SetPage("maps"), true)); return; }
        var poster = BuildPoster(); body.Children.Add(Ui.Text("你的城市，值得被看见。", 26, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Space(10)); body.Children.Add(Ui.Muted("海报包含邀请码。分享给可以共同编辑地图的人。")); body.Children.Add(Ui.Space(22)); var exportButton = Ui.Button("保存海报 PNG", () => { var picker = new SaveFileDialog { Filter = "PNG 海报|*.png", FileName = $"modu-poster-{active.Code}.png" }; if (picker.ShowDialog(this) != true) return; try { poster.Measure(new System.Windows.Size(640, 820)); poster.Arrange(new Rect(0, 0, 640, 820)); poster.UpdateLayout(); var bitmap = new RenderTargetBitmap(1280, 1640, 192, 192, PixelFormats.Pbgra32); bitmap.Render(poster); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); using var file = File.Create(picker.FileName); encoder.Save(file); Notice("海报已保存"); } catch (Exception e) { Notice(Error(e)); } }, true); exportButton.HorizontalAlignment = HorizontalAlignment.Center; body.Children.Add(exportButton); body.Children.Add(Ui.Space(24)); var box = new Viewbox { Width = 400, Height = 512, HorizontalAlignment = HorizontalAlignment.Center, Child = poster }; body.Children.Add(box);
    }
    private Border BuildPoster() { var column = Ui.Column(Ui.Text("M O D U   /   E X P L O R E", 13, "#B2C8B3"), Ui.Space(50), Ui.Text("把城市，\n走成自己的故事。", 44, "#F4F2DA", FontWeights.SemiBold), Ui.Space(35), Ui.Text(active?.Name ?? "城市漫游", 27, "#E9EBCF"), Ui.Space(15), Ui.Text($"{places.Count:00} 个收藏    /    {places.Count(p => p.Visited):00} 个足迹", 18, "#B6CBB5"), Ui.Space(35)); var cats = Ui.Wrap(); foreach (var c in Rules.Categories.Where(c => places.Any(p => p.Category == c))) cats.Children.Add(Ui.Text($"{Rules.Emoji(c)} {c}  ", 18, "#E0E9CF")); column.Children.Add(cats); column.Children.Add(Ui.Space(55)); column.Children.Add(Ui.Text("一起出发。", 24, "#F4F2DA")); column.Children.Add(Ui.Space(10)); column.Children.Add(Ui.Text("邀请码   " + active?.Code, 26, "#DB9B7B", FontWeights.SemiBold)); column.Children.Add(Ui.Space(12)); column.Children.Add(Ui.Text(api.BaseUrl + "/?map=" + active?.Code, 11, "#AAC0AD")); column.Children.Add(Ui.Space(30)); column.Children.Add(Ui.Text("A SMALL JOURNEY, A GOOD DAY.", 11, "#98B29E")); return new Border { Width = 640, Height = 820, Background = Ui.Brush("#203F32"), Padding = new Thickness(52), Child = column }; }
    private void RenderSettings(StackPanel body)
    {
        body.Children.Add(Ui.Eyebrow("MAKE IT YOURS")); body.Children.Add(Ui.Space(10));
        body.Children.Add(Ui.Row(Ui.Avatar(58), Ui.Column(Ui.Text("每一次出发，都有你的风格。", 26, weight: FontWeights.SemiBold), Ui.Space(6), Ui.Muted("魔都漫游 / Windows 0.1.0 体验版")))); body.Children.Add(Ui.Space(30));
        var nickname = Ui.Input("昵称", store.Settings.Nickname, 30);
        var profile = Ui.Card(Ui.Column(Ui.Eyebrow("01 / PROFILE"), Ui.Space(8), Ui.Text("城市署名", 19, weight: FontWeights.SemiBold), Ui.Space(8), Ui.Muted("为想去、照片和留言，留下你的名字。"), Ui.Space(20), nickname, Ui.Space(16), Ui.Button("保存昵称", () => { if (string.IsNullOrWhiteSpace(nickname.Text)) { Notice("昵称不能为空"); return; } store.Settings.Nickname = nickname.Text.Trim(); store.Save(); Notice("昵称已保存"); }, true)), new Thickness(24));
        var theme = new ComboBox { ItemsSource = new[] { "跟随 Windows 系统", "浅色 · 暖白", "深色 · 墨绿" }, SelectedIndex = store.Settings.ThemeMode switch { "light" => 1, "dark" => 2, _ => 0 } }; System.Windows.Automation.AutomationProperties.SetName(theme, "界面主题");
        theme.SelectionChanged += (_, _) => { store.Settings.ThemeMode = theme.SelectedIndex switch { 1 => "light", 2 => "dark", _ => "system" }; ApplyTheme(IsDark()); store.Save(); };
        var preview = new CheckBox { Content = "在检查更新时包含体验版", IsChecked = store.Settings.PreviewUpdates }; preview.Click += (_, _) => { store.Settings.PreviewUpdates = preview.IsChecked == true; store.Save(); };
        var appearance = Ui.Card(Ui.Column(Ui.Eyebrow("02 / APPEARANCE"), Ui.Space(8), Ui.Text("外观与更新", 19, weight: FontWeights.SemiBold), Ui.Space(8), Ui.Muted("选一种氛围，安心探索每一次新体验。"), Ui.Space(20), theme, Ui.Space(6), preview, Ui.Space(10), Ui.Wrap(Ui.Button("检查更新", () => _ = CheckUpdates()), Ui.Button("更新日志", ShowHistory))), new Thickness(24));
        body.Children.Add(Ui.Pair(profile, appearance, Ui.CardGap)); body.Children.Add(Ui.Space(12));
        var privacy = Ui.Card(Ui.Column(Ui.Eyebrow("03 / MAP & PRIVACY"), Ui.Space(8), Ui.Text("地图与隐私", 19, weight: FontWeights.SemiBold), Ui.Space(12), Ui.Muted("地图使用高德服务。邀请码保存在这台电脑，持有码的人可以共同管理地图。"), Ui.Space(18), Ui.Wrap(Ui.Button(store.Settings.MapConsent ? "地图服务已开启" : "开启地图服务", () => _ = ConsentMap()), Ui.Button("高德隐私政策 ↗", () => OpenUrl(new Uri("https://lbs.amap.com/pages/privacy/"))))), new Thickness(24));
        var shortcuts = Ui.Card(Ui.Column(Ui.Eyebrow("04 / SHORTCUTS"), Ui.Space(8), Ui.Text("键盘也能带路", 19, weight: FontWeights.SemiBold), Ui.Space(12), Ui.Muted("Ctrl + F   搜索收藏\nCtrl + N   标记地点\nF5   刷新数据     Esc   收起详情\nTab   移动焦点     Enter / 空格   激活按钮", 12)), new Thickness(24));
        body.Children.Add(Ui.Pair(privacy, shortcuts, Ui.CardGap)); body.Children.Add(Ui.Space(18)); body.Children.Add(Ui.Muted("运行数据保存在当前用户的本机目录，无需管理员权限。", 11));
    }
}
