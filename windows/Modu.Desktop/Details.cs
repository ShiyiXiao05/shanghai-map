using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow
{
    private List<Photo> detailPhotos = [];
    private List<Comment> detailComments = [];
    private StackPanel photoPanel = new(), commentPanel = new();
    private TextBox? commentInput;
    private bool photosReady, commentsReady;
    private void CloseDetail() { selected = null; detailRevision++; detailCancellation.Cancel(); detailBorder.Visibility = Visibility.Collapsed; exploreGrid.ColumnDefinitions[3].Width = new GridLength(0); exploreGrid.ColumnDefinitions[0].Width = new GridLength(300); details.Children.Clear(); _ = MapScript("window.setPick(false)"); }
    private void SelectPlace(Place p)
    {
        if (page != "explore") SetPage("explore"); selected = p; detailCancellation.Cancel(); detailCancellation.Dispose(); detailCancellation = new(); var stamp = ++detailRevision; var code = active?.Code;
        detailBorder.Visibility = Visibility.Visible; exploreGrid.ColumnDefinitions[3].Width = new GridLength(340); exploreGrid.ColumnDefinitions[0].Width = new GridLength(ActualWidth < 1260 ? 0 : 280);
        details.Children.Clear(); details.Children.Add(Ui.Row(Ui.Badge(p.Category), Ui.Quiet("×", () => { CloseDetail(); RenderPlaces(); }, "关闭详情 · Esc"))); details.Children.Add(Ui.Space(14)); details.Children.Add(Ui.Text(p.DisplayEmoji, 42)); details.Children.Add(Ui.Space(12)); details.Children.Add(Ui.Text(p.Name, 24, weight: FontWeights.SemiBold)); details.Children.Add(Ui.Space(8)); details.Children.Add(Ui.Muted(p.Address, 12)); details.Children.Add(Ui.Space(16));
        var badges = new WrapPanel(); if (p.Visited) badges.Children.Add(Ui.Badge("✓ 已去过")); if (p.IsPublic) badges.Children.Add(Ui.Badge("公共可见")); if (!string.IsNullOrWhiteSpace(p.PriceHint)) badges.Children.Add(Ui.Badge(p.PriceHint)); if (!string.IsNullOrWhiteSpace(p.Hours)) badges.Children.Add(Ui.Badge(p.Hours)); details.Children.Add(badges);
        if (!string.IsNullOrWhiteSpace(p.Description)) details.Children.Add(Ui.Text(p.Description, 13)); if (!string.IsNullOrWhiteSpace(p.Tags)) { details.Children.Add(Ui.Space(10)); details.Children.Add(Ui.Muted(p.Tags, 11)); }
        details.Children.Add(Ui.Space(18));
        details.Children.Add(Ui.Wrap(Ui.Button("↗ 高德导航", () => OpenUrl(Rules.Navigation(p)), true), Ui.Button("分享链接", () => Copy(api.BaseUrl + "/?" + (code == null ? "" : $"map={code}&") + $"place={p.Id}"))));
        if (code != null)
        {
            details.Children.Add(Ui.Wrap(Ui.Button(p.Wishes.Contains(store.Settings.Nickname) ? $"♥ 想去 {p.Wishes.Count}" : $"♡ 想去 {p.Wishes.Count}", () => _ = Wish(p)), Ui.Button(p.Visited ? "撤销打卡" : "✓ 我去过了", () => _ = Visit(p))));
            if (p.Wishes.Count > 0) details.Children.Add(Ui.Muted(string.Join("、", p.Wishes) + " 想去", 11));
            details.Children.Add(Ui.Wrap(Ui.Quiet("编辑地点", () => EditPlace(p)), Ui.Quiet(p.IsPublic ? "取消公开" : "公开到广场", () => _ = TogglePublic(p)), Ui.Quiet("加入行程", () => _ = AddToRoute(p))));
            details.Children.Add(Ui.Rule());
            photoPanel = new(); commentPanel = new(); detailPhotos = []; detailComments = []; photosReady = false; commentsReady = false;
            details.Children.Add(Ui.Row(Ui.Text("照片", 15, weight: FontWeights.SemiBold), Ui.Quiet("＋ 上传", () => _ = UploadPhoto(p)))); details.Children.Add(photoPanel); details.Children.Add(Ui.Space(16));
            details.Children.Add(Ui.Text("留言", 15, weight: FontWeights.SemiBold)); details.Children.Add(Ui.Space(10)); details.Children.Add(commentPanel); commentInput = Ui.Input("留言", max: 280, multi: true); commentInput.MinHeight = 74; details.Children.Add(commentInput); details.Children.Add(Ui.Space(8)); details.Children.Add(Ui.Button("发送留言", () => _ = SendComment(p, commentInput), true));
            var key = code + ":" + p.Id; if (demo) { photosReady = true; commentsReady = true; RenderPhotos(p, stamp); RenderComments(p); } else if (mediaCache.TryGetValue(key, out var cached) && DateTimeOffset.Now - cached.Time < TimeSpan.FromSeconds(60)) { detailPhotos = cached.Photos; detailComments = cached.Comments; photosReady = true; commentsReady = true; RenderPhotos(p, stamp); RenderComments(p); } else { photoPanel.Children.Add(Ui.Muted("正在加载照片…")); commentPanel.Children.Add(Ui.Muted("正在加载留言…")); _ = LoadPhotos(code, p, stamp, detailCancellation.Token); _ = LoadComments(code, p, stamp, detailCancellation.Token); }
            details.Children.Add(Ui.Rule()); details.Children.Add(Ui.Quiet("移入回收站", () => _ = RemovePlace(p)));
        }
        else details.Children.Add(Ui.Muted("公共地点仅供浏览。创建或加入地图后，可管理你的照片、留言与行程。", 12));
        details.Children.Add(Ui.Space(10)); details.Children.Add(Ui.Muted($"由 {p.AddedBy.DefaultIfEmpty("城市探索者")} 标记", 10)); details.Children.Add(Ui.Quiet("举报内容", () => ReportDialog(p))); RenderPlaces(); _ = MapScript("window.focusPlace(" + System.Text.Json.JsonSerializer.Serialize(p, Wire.Json) + ")");
    }
    private async Task Wish(Place p)
    {
        if (writing || !RequireMap() || !RequireNickname()) return; var code = active!.Code; var original = places.Find(x => x.Id == p.Id) ?? p; var names = original.Wishes.ToList(); if (!names.Remove(store.Settings.Nickname)) names.Add(store.Settings.Nickname); UpdatePlace(original with { Wishes = names }); SelectPlace(selected!);
        await RunWrite(async () => { var result = await api.Wish(code, p.Id, store.Settings.Nickname); UpdatePlace(original with { Wishes = result }); if (selected?.Id == p.Id) SelectPlace(selected); }, "想去已更新", () => { UpdatePlace(original); if (selected?.Id == p.Id) SelectPlace(original); });
    }
    private async Task Visit(Place p)
    {
        if (writing || !RequireMap()) return; var code = active!.Code;
        await RunWrite(async () => { var next = await api.Visit(code, p); UpdatePlace(next); if (selected?.Id == p.Id) SelectPlace(next); }, p.Visited ? "已撤销打卡" : "又多了一段城市回忆");
    }
    private async Task TogglePublic(Place p)
    {
        if (writing || !RequireMap()) return; if (!Confirm(p.IsPublic ? "取消公开？" : "公开到公共广场？", p.IsPublic ? "该地点将不再展示在公共广场。" : "地点信息会向所有用户展示，邀请码不会公开。")) return; var code = active!.Code;
        await RunWrite(async () => { var visible = await api.Publish(code, p.Id); UpdatePlace((places.Find(x => x.Id == p.Id) ?? p) with { IsPublic = visible }); if (selected?.Id == p.Id) SelectPlace(selected); }, "公开状态已更新");
    }
    private async Task RemovePlace(Place p)
    {
        if (writing || !RequireMap() || !Confirm("移入回收站？", "照片和留言一起保留 30 天，期间可以恢复。")) return; var code = active!.Code;
        await RunWrite(async () => { await api.DeletePlace(code, p.Id); places.RemoveAll(x => x.Id == p.Id); store.Cache(code, places); mediaCache.Remove(code + ":" + p.Id); CloseDetail(); RenderPlaces(); }, "地点已移入回收站");
    }
    private async Task LoadPhotos(string code, Place p, int stamp, CancellationToken ct)
    {
        try { var next = await api.Photos(code, p.Id, ct); if (stamp != detailRevision) return; detailPhotos = next; photosReady = true; RenderPhotos(p, stamp); CacheMedia(code, p.Id); } catch (OperationCanceledException) when (ct.IsCancellationRequested) { } catch (Exception e) { if (stamp != detailRevision) return; photoPanel.Children.Clear(); photoPanel.Children.Add(Ui.Muted(Error(e))); photoPanel.Children.Add(Ui.Button("重试照片", () => _ = LoadPhotos(code, p, stamp, ct))); }
    }
    private async Task LoadComments(string code, Place p, int stamp, CancellationToken ct)
    {
        try { var next = await api.Comments(code, p.Id, ct); if (stamp != detailRevision) return; detailComments = next; commentsReady = true; RenderComments(p); CacheMedia(code, p.Id); } catch (OperationCanceledException) when (ct.IsCancellationRequested) { } catch (Exception e) { if (stamp != detailRevision) return; commentPanel.Children.Clear(); commentPanel.Children.Add(Ui.Muted(Error(e))); commentPanel.Children.Add(Ui.Button("重试留言", () => _ = LoadComments(code, p, stamp, ct))); }
    }
    private void CacheMedia(string code, long id) { if (photosReady && commentsReady) mediaCache[code + ":" + id] = (DateTimeOffset.Now, detailPhotos.ToList(), detailComments.ToList()); }
    private void RenderPhotos(Place p, int stamp)
    {
        photoPanel.Children.Clear(); if (detailPhotos.Count == 0) { photoPanel.Children.Add(Ui.Muted("还没有照片，把这一刻留在这里。", 12)); return; }
        var wrap = new WrapPanel(); photoPanel.Children.Add(wrap); var code = active!.Code;
        foreach (var photo in detailPhotos) { var image = new System.Windows.Controls.Image { Width = 126, Height = 95, Stretch = Stretch.UniformToFill }; var picture = Ui.Button("查看照片", () => _ = PreviewPhoto(photo, code)); picture.Content = image; picture.Padding = new Thickness(0); picture.Width = 126; picture.Height = 95; picture.Margin = new Thickness(0, 0, 8, 0); var tile = Ui.Column(picture, Ui.Quiet("删除", () => _ = DeletePhoto(p, photo))); tile.Margin = new Thickness(0, 0, 0, 8); wrap.Children.Add(tile); _ = Load(); async Task Load() { try { image.Source = await Images.Load(photo.Thumb, detailCancellation.Token); } catch (OperationCanceledException) { } catch { if (stamp == detailRevision) picture.Content = Ui.Muted("图片加载失败\n点击查看原图", 10); } } }
    }
    private async Task PreviewPhoto(Photo photo, string code)
    {
        var (w, body, footer) = Dialog("照片", photo.AddedBy, 840); var image = new System.Windows.Controls.Image { MaxHeight = 520, Stretch = Stretch.Uniform }; var error = Ui.Muted("正在加载原图…"); body.Children.Add(error); body.Children.Add(image);
        var uri = photo.Full ?? $"{api.BaseUrl}/api/photos/{photo.Id}?map={code}";
        footer.Children.Add(Ui.Button("保存图片", () => { if (image.Source is not BitmapSource b) return; var picker = new SaveFileDialog { Filter = "PNG 图片|*.png", FileName = $"modu-photo-{photo.Id}.png" }; if (picker.ShowDialog(w) != true) return; try { var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(b)); using var file = File.Create(picker.FileName); encoder.Save(file); Notice("照片已保存"); } catch (Exception e) { error.Text = Error(e); } }));
        _ = Load(); async Task Load() { try { image.Source = await Images.Load(uri); error.Text = ""; } catch (Exception e) { error.Text = Error(e); } }
        w.ShowDialog(); await Task.CompletedTask;
    }
    private async Task UploadPhoto(Place p)
    {
        if (writing || !RequireNickname() || active == null) return; if (!photosReady) { Notice("请先等待照片加载完成，或重试照片加载"); return; }
        if (detailPhotos.Count >= 9) { Notice("每个地点最多 9 张照片"); return; }
        var picker = new OpenFileDialog { Filter = "照片|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tif;*.tiff" }; if (picker.ShowDialog(this) != true) return; var code = active.Code; var stamp = detailRevision;
        await RunWrite(async () => { var (full, thumb) = await Images.Prepare(picker.FileName); var id = await api.Upload(code, p.Id, full, thumb, store.Settings.Nickname); if (stamp != detailRevision) return; detailPhotos.Add(new(id, thumb, full, store.Settings.Nickname)); RenderPhotos(p, stamp); UpdatePlace((selected ?? p) with { PhotoCount = detailPhotos.Count }); CacheMedia(code, p.Id); }, "照片已上传");
    }
    private async Task DeletePhoto(Place p, Photo photo)
    {
        if (writing || active == null || !Confirm("删除这张照片？", "删除后无法恢复。")) return; var code = active.Code; var stamp = detailRevision;
        await RunWrite(async () => { await api.DeletePhoto(code, photo.Id); if (stamp != detailRevision) return; detailPhotos.RemoveAll(x => x.Id == photo.Id); RenderPhotos(p, stamp); UpdatePlace((selected ?? p) with { PhotoCount = detailPhotos.Count }); CacheMedia(code, p.Id); }, "照片已删除");
    }
    private void RenderComments(Place p)
    {
        commentPanel.Children.Clear(); if (detailComments.Count == 0) commentPanel.Children.Add(Ui.Muted("还没有留言，分享你的发现。", 12));
        foreach (var c in detailComments) { var card = Ui.Column(Ui.Text(c.Author.DefaultIfEmpty("城市探索者"), 12, weight: FontWeights.SemiBold), Ui.Space(3), Ui.Text(c.Body, 12), Ui.Row(Ui.Muted(c.CreatedAt.Length >= 10 ? c.CreatedAt[..10] : "", 10), Ui.Quiet("删除", () => _ = DeleteComment(p, c)))); var frame = Ui.Card(card, new Thickness(12), 10); frame.Margin = new Thickness(0, 0, 0, 10); commentPanel.Children.Add(frame); }
        commentPanel.Children.Add(Ui.Space(10));
    }
    private async Task SendComment(Place p, TextBox input)
    {
        if (writing || active == null || !RequireNickname() || string.IsNullOrWhiteSpace(input.Text)) return; if (!commentsReady) { Notice("请先等待留言加载完成，或重试留言加载"); return; }
        var code = active.Code; var text = input.Text.Trim(); var stamp = detailRevision; var temporary = new Comment(-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), text, store.Settings.Nickname); detailComments.Add(temporary); RenderComments(p); input.IsEnabled = false;
        await RunWrite(async () => { var created = await api.Comment(code, p.Id, text, store.Settings.Nickname); if (stamp != detailRevision) return; detailComments.RemoveAll(x => x.Id == temporary.Id); detailComments.Add(created); input.Clear(); RenderComments(p); UpdatePlace((selected ?? p) with { CommentCount = detailComments.Count }); CacheMedia(code, p.Id); }, "留言已发送", () => { if (stamp == detailRevision) { detailComments.RemoveAll(x => x.Id == temporary.Id); RenderComments(p); } }); input.IsEnabled = true;
    }
    private async Task DeleteComment(Place p, Comment c)
    {
        if (writing || active == null || c.Id <= 0 || !Confirm("删除这条留言？", "删除后无法恢复。")) return; var code = active.Code; var stamp = detailRevision;
        await RunWrite(async () => { await api.DeleteComment(code, c.Id); if (stamp != detailRevision) return; detailComments.RemoveAll(x => x.Id == c.Id); RenderComments(p); UpdatePlace((selected ?? p) with { CommentCount = detailComments.Count }); CacheMedia(code, p.Id); }, "留言已删除");
    }
    private void ReportDialog(Place p) { var (w, body, footer) = Dialog("举报内容", "选择原因，我们会记录并交由地图管理者处理。", 490); foreach (var reason in new[] { "违法违规", "色情低俗", "广告骚扰", "侵犯隐私", "其他问题" }) body.Children.Add(Ui.Button(reason, () => _ = RunWrite(async () => { await api.Report(active?.Code, p.Id, reason, store.Settings.Nickname); _ = Dispatcher.BeginInvoke(() => w.Close()); }, "举报已提交"))); w.ShowDialog(); }
}
internal static class TextExtensions { public static string DefaultIfEmpty(this string? text, string fallback) => string.IsNullOrWhiteSpace(text) ? fallback : text; }
