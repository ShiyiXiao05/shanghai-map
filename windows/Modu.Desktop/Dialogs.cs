using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow
{
    private (Window Window, StackPanel Body, StackPanel Footer) Dialog(string heading, string subheading = "", double width = 590)
    {
        var w = new Window { Owner = this, Title = heading, Width = width, SizeToContent = SizeToContent.Height, MaxHeight = Math.Min(880, SystemParameters.WorkArea.Height - 60), WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, FontFamily = FontFamily };
        Ui.Resource(w, BackgroundProperty, "Canvas"); var panel = new Grid { Margin = new Thickness(28) }; panel.RowDefinitions.Add(new() { Height = GridLength.Auto }); panel.RowDefinitions.Add(new() { MaxHeight = 610 }); panel.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var header = Ui.Column(Ui.Text(heading, 24, weight: FontWeights.SemiBold), Ui.Space(5), Ui.Muted(subheading, 12), Ui.Space(22)); panel.Children.Add(header);
        var body = new StackPanel(); var scroll = new ScrollViewer { Content = body }; Grid.SetRow(scroll, 1); panel.Children.Add(scroll);
        var footer = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 20, 0, 0) }; footer.Children.Add(Ui.Quiet("取消", () => w.Close())); Grid.SetRow(footer, 2); panel.Children.Add(footer); w.Content = panel;
        w.PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape && !writing) { w.Close(); e.Handled = true; } }; w.Closing += (_, e) => { if (writing) e.Cancel = true; };
        dialogControls.Add(body); dialogControls.Add(footer); w.Closed += (_, _) => { dialogControls.Remove(body); dialogControls.Remove(footer); };
        return (w, body, footer);
    }
    private bool Confirm(string heading, string message)
    {
        var (w, body, footer) = Dialog(heading, message, 520); footer.Children.Add(Ui.Button("确认", () => w.DialogResult = true, true)); return w.ShowDialog() == true;
    }
    private void NicknameDialog()
    {
        var (w, body, footer) = Dialog("你的城市署名", "用于想去、照片和留言。", 480); var input = Ui.Input("昵称", store.Settings.Nickname, 30); body.Children.Add(Ui.Field("昵称 · 最多 30 字", input));
        footer.Children.Add(Ui.Button("保存署名", () => { if (string.IsNullOrWhiteSpace(input.Text)) { Notice("昵称不能为空"); return; } store.Settings.Nickname = input.Text.Trim(); store.Save(); w.DialogResult = true; }, true)); w.Loaded += (_, _) => input.Focus(); w.ShowDialog();
    }
    private void OpenAdd()
    {
        if (writing || !RequireMap()) return;
        var (w, body, footer) = Dialog("发现一个新地点", "搜索地点、粘贴高德分享，或手动填写坐标。", 670);
        var input = Ui.Input("地点名称或高德分享文本", max: 1500); var results = new StackPanel(); var message = Ui.Muted("搜索结果由高德提供。分享文本中的坐标可直接导入。", 12);
        Button searchButton = null!; searchButton = Ui.Button("搜索 / 识别", () => _ = Search(), true); body.Children.Add(Ui.Field("名称 / 分享文本", input)); body.Children.Add(Ui.Row(searchButton, Ui.Button("手动输入坐标", () => { w.Close(); EditPlace(null, new("", "", 121.4737, 31.2304)); }))); body.Children.Add(Ui.Space(16)); body.Children.Add(message); body.Children.Add(Ui.Space(12)); body.Children.Add(results);
        async Task Search()
        {
            if (string.IsNullOrWhiteSpace(input.Text)) return; searchButton.IsEnabled = false; message.Text = "正在查找…";
            try { var point = Rules.ParseShare(input.Text); var next = point == null ? await SearchMap(input.Text.Trim()) : new List<PickedPoint> { point }; results.Children.Clear(); foreach (var p in next) { var current = p; var b = Ui.Button(p.Name + "\n" + p.Address, () => { w.Close(); EditPlace(null, current); }); b.HorizontalContentAlignment = HorizontalAlignment.Left; b.Margin = new Thickness(0, 0, 0, 8); results.Children.Add(b); } message.Text = next.Count > 0 ? $"找到 {next.Count} 个地点，选择后编辑保存。" : "没有找到地点，请换个关键词。"; } catch (Exception e) { message.Text = Error(e); } finally { searchButton.IsEnabled = true; }
        }
        input.KeyDown += (_, e) => { if (e.Key == Key.Enter) { _ = Search(); e.Handled = true; } }; w.ShowDialog();
    }
    private void EditPlace(Place? original, PickedPoint? point = null)
    {
        if (writing || !RequireMap() || !RequireNickname()) return; var code = active!.Code;
        var p = original ?? new Place { Name = point?.Name ?? "", Address = point?.Address ?? "", Lng = point?.Lng ?? 121.4737, Lat = point?.Lat ?? 31.2304, AddedBy = store.Settings.Nickname };
        var (w, body, footer) = Dialog(original == null ? "标记一个地点" : "编辑地点", "让这个地方拥有属于你的注脚。", 660);
        var name = Ui.Input("地点名称", p.Name, 100); var address = Ui.Input("地址", p.Address, 200); var description = Ui.Input("描述", p.Description, 500, true); var price = Ui.Input("人均价格", p.PriceHint, 50); var hours = Ui.Input("营业时间", p.Hours, 100); var tags = Ui.Input("标签", p.Tags, 100); var emoji = Ui.Input("自定义 emoji", p.Emoji, 32);
        var kind = new ComboBox { ItemsSource = Rules.Categories, SelectedItem = p.Category }; System.Windows.Automation.AutomationProperties.SetName(kind, "地点分类");
        var lng = Ui.Input("经度", p.Lng.ToString("0.######", CultureInfo.InvariantCulture)); var lat = Ui.Input("纬度", p.Lat.ToString("0.######", CultureInfo.InvariantCulture));
        body.Children.Add(Ui.Field("地点名称", name)); body.Children.Add(Ui.Field("分类", kind)); body.Children.Add(Ui.Field("地点图标 · 留空使用分类默认 emoji", emoji, "Windows + . 可打开系统表情选择器"));
        var choices = new WrapPanel(); foreach (var e in new[] { "🏞️", "🍜", "🏛️", "🛍️", "🎡", "📍", "☕", "🌳", "🌸", "🌉", "🎨", "🍰" }) choices.Children.Add(Ui.Quiet(e, () => emoji.Text = e)); body.Children.Add(choices); body.Children.Add(Ui.Space(12));
        body.Children.Add(Ui.Field("地址", address)); body.Children.Add(Ui.Field("描述 · 最多 500 字", description)); body.Children.Add(Ui.Field("人均价格", price)); body.Children.Add(Ui.Field("营业时间", hours)); body.Children.Add(Ui.Field("标签", tags));
        body.Children.Add(Ui.Field("经度（高德 GCJ-02）", lng)); body.Children.Add(Ui.Field("纬度（高德 GCJ-02）", lat)); var error = Ui.Text("", 12, "#B35D4C"); body.Children.Add(error);
        Button save = null!; save = Ui.Button("保存地点", () => _ = Save(), true); footer.Children.Add(save);
        async Task Save()
        {
            Place value;
            try { if (!double.TryParse(lng.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var x) || !double.TryParse(lat.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var y)) throw new ArgumentException("经纬度需要填写数字"); value = p with { Name = name.Text.Trim(), Category = kind.SelectedItem?.ToString() ?? "", Address = address.Text.Trim(), Description = description.Text.Trim(), PriceHint = price.Text.Trim(), Hours = hours.Text.Trim(), Tags = tags.Text.Trim(), Emoji = emoji.Text.Trim(), Lng = x, Lat = y }; Rules.Validate(value); } catch (Exception e) { error.Text = Error(e); return; }
            save.IsEnabled = false;
            await RunWrite(async () => { try { var saved = await api.Save(code, value, original == null); UpdatePlace(saved); _ = Dispatcher.BeginInvoke(() => { w.DialogResult = true; SetPage("explore"); SelectPlace(saved); }); } catch (Exception e) { error.Text = Error(e); throw; } }, "地点已保存"); save.IsEnabled = true;
        }
        w.ShowDialog();
    }
    private void DrawPlace() { var candidates = Rules.Filter(places, query, category, unvisited, sort).ToList(); if (candidates.Count == 0) { Notice("当前筛选下没有可抽取的地点"); return; } var p = candidates[Random.Shared.Next(candidates.Count)]; var (w, body, footer) = Dialog("下一站，去这里。", "给平常的一天一点随机惊喜。", 490); var name = Ui.Text(p.Name, 26, weight: FontWeights.SemiBold); var emoji = Ui.Text(p.DisplayEmoji, 60); body.Children.Add(Ui.Column(emoji, Ui.Space(14), name, Ui.Space(8), Ui.Muted(p.Address))); footer.Children.Add(Ui.Button("再抽一次", () => { p = candidates[Random.Shared.Next(candidates.Count)]; name.Text = p.Name; emoji.Text = p.DisplayEmoji; })); footer.Children.Add(Ui.Button("看看这个地方", () => { w.Close(); SetPage("explore"); SelectPlace(p); }, true)); w.ShowDialog(); }
}
