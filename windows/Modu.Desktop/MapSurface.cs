using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow
{
    private bool mapStarting;
    private async Task ConsentMap()
    {
        if (!store.Settings.MapConsent)
        {
            var (window, body, footer) = Dialog("开启地图服务", "地图、地点搜索和定位由高德提供。", 510);
            body.Children.Add(Ui.Muted("开启后地图服务会处理必要的设备及网络信息；定位仅在你主动使用并授权后进行。你也可以继续使用地点列表。", 13));
            body.Children.Add(Ui.Space()); body.Children.Add(Ui.Quiet("查看高德隐私政策 ↗", () => OpenUrl(new Uri("https://lbs.amap.com/pages/privacy/"))));
            footer.Children.Add(Ui.Button("暂不开启", () => window.Close())); footer.Children.Add(Ui.Button("同意并开启", () => { store.Settings.MapConsent = true; store.Save(); window.DialogResult = true; }, true));
            if (window.ShowDialog() != true) return;
        }
        await InitMap();
    }
    private async Task InitMap()
    {
        if (mapStarting || mapLoaded || closing) return; mapStarting = true; mapHint.Text = "正在连接地图服务…";
        try
        {
            var assembly = Assembly.GetExecutingAssembly(); var resource = assembly.GetManifestResourceNames().Single(n => n.EndsWith("map.html"));
            var assets = Path.Combine(store.DirectoryPath, "map-assets"); Directory.CreateDirectory(assets);
            using (var source = assembly.GetManifestResourceStream(resource)!) using (var target = File.Create(Path.Combine(assets, "map.html"))) await source.CopyToAsync(target);
            mapFrame.Padding = new Thickness(0); mapFrame.Child = mapView; mapFrame.UpdateLayout();
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(store.DirectoryPath, "webview"));
            await mapView.EnsureCoreWebView2Async(environment).WaitAsync(TimeSpan.FromSeconds(25));
            var web = mapView.CoreWebView2; web.Settings.AreDefaultContextMenusEnabled = false; web.Settings.AreDevToolsEnabled = false; web.Settings.IsStatusBarEnabled = false;
            web.SetVirtualHostNameToFolderMapping("modu-map.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            web.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("https://modu-map.local/", StringComparison.Ordinal)) e.Cancel = true; };
            web.NewWindowRequested += (_, e) => e.Handled = true;
            web.PermissionRequested += (_, e) =>
            {
                if (e.PermissionKind == CoreWebView2PermissionKind.Geolocation && store.Settings.MapConsent && e.Uri.StartsWith("https://modu-map.local/"))
                {
                    e.State = MessageBox.Show(this, "允许高德地图获取当前位置？", "位置授权", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
                }
                else e.State = CoreWebView2PermissionState.Deny;
            };
            web.WebMessageReceived += async (_, e) =>
            {
                if (e.Source != "https://modu-map.local/map.html") return;
                try
                {
                    var message = JsonDocument.Parse(e.WebMessageAsJson).RootElement; var type = message.GetProperty("type").GetString(); if (writing && type is "select" or "pick") return;
                    switch (type)
                    {
                        case "loaded": mapLoaded = true; var config = await api.Get<MapConfiguration>("/api/map-config"); await MapScript("window.initMap(" + JsonSerializer.Serialize(config, Wire.Json) + ")"); RenderPlaces(); break;
                        case "ready": mapHint.Text = "高德地图 · 双击缩放，拖动探索"; await MapScript("window.setTheme(" + (IsDark() ? "true" : "false") + ")"); break;
                        case "select": var id = message.GetProperty("id").GetInt64(); if (places.Find(p => p.Id == id) is Place p) SelectPlace(p); break;
                        case "pick": await MapScript("window.setPick(false)"); mapHint.Text = "已选择坐标"; if (active != null) EditPlace(null, new("", "", message.GetProperty("lng").GetDouble(), message.GetProperty("lat").GetDouble())); break;
                        case "search": var token = message.GetProperty("token").GetString()!; if (searchRequests.Remove(token, out var request)) { var error = message.GetProperty("error").GetString(); if (!string.IsNullOrEmpty(error)) request.TrySetException(new InvalidOperationException(error)); else request.TrySetResult(message.GetProperty("points").Deserialize<List<PickedPoint>>(Wire.Json) ?? []); } break;
                        case "location": var point = new Place { Lng = message.GetProperty("lng").GetDouble(), Lat = message.GetProperty("lat").GetDouble() }; ShowNearby(point); break;
                        case "error": Notice(message.GetProperty("message").GetString() ?? "地图服务暂不可用"); break;
                    }
                }
                catch (Exception error) { mapHint.Text = "地图服务暂不可用，可重试连接"; Notice("地图服务 · " + Error(error)); }
            };
            mapFrame.Padding = new Thickness(0); mapFrame.Child = mapView; web.Navigate("https://modu-map.local/map.html");
        }
        catch (Exception e) { mapLoaded = false; mapHint.Text = "地图暂不可用 · 点击重试"; mapFrame.Padding = new Thickness(30); mapFrame.Child = Ui.Column(Ui.Space(40), Ui.Text("地图服务暂不可用", 20), Ui.Space(10), Ui.Muted(Error(e)), Ui.Space(18), Ui.Button("重试连接", () => _ = InitMap()), Ui.Quiet("安装 WebView2 运行时 ↗", () => OpenUrl(new Uri("https://developer.microsoft.com/microsoft-edge/webview2/")))); }
        finally { mapStarting = false; }
    }
    private async Task MapScript(string script) { if (!mapLoaded || closing) return; try { await mapView.CoreWebView2.ExecuteScriptAsync(script); } catch (Exception e) { if (!closing) Notice("地图通信失败 · " + Error(e)); } }
    private async Task Locate() { if (!store.Settings.MapConsent) { await ConsentMap(); } if (mapLoaded) await MapScript("window.locate()"); }
    private void ToggleMapFocus() { if (exploreGrid.ColumnDefinitions[0].Width.Value == 0 && selected == null) { exploreGrid.ColumnDefinitions[0].Width = new GridLength(300); } else { CloseDetail(); exploreGrid.ColumnDefinitions[0].Width = new GridLength(0); } }
    private async Task PickOnMap() { if (!RequireMap()) return; if (!store.Settings.MapConsent) await ConsentMap(); if (mapLoaded) { mapHint.Text = "点击地图选择一个地点 · Esc 取消"; await MapScript("window.setPick(true)"); } }
    private async Task<List<PickedPoint>> SearchMap(string text)
    {
        if (!store.Settings.MapConsent) await ConsentMap(); if (!mapLoaded) throw new InvalidOperationException("地图尚未就绪，请稍后再试");
        var token = Guid.NewGuid().ToString("N"); var completion = new TaskCompletionSource<List<PickedPoint>>(TaskCreationOptions.RunContinuationsAsynchronously); searchRequests[token] = completion;
        try { await MapScript($"window.searchPlaces({JsonSerializer.Serialize(text)},{JsonSerializer.Serialize(token)})"); return await completion.Task.WaitAsync(TimeSpan.FromSeconds(25)); }
        finally { searchRequests.Remove(token); }
    }
    private void ShowNearby(Place location)
    {
        var (window, body, footer) = Dialog("你附近的收藏", "按直线距离排序，距离不等于实际步行路线。", 540);
        foreach (var p in places.OrderBy(p => Rules.Distance(p, location)).Take(8)) { var captured = p; body.Children.Add(Ui.Button($"{p.DisplayEmoji}  {p.Name}   ·   {Rules.DistanceText(Rules.Distance(p, location))}", () => { window.Close(); SetPage("explore"); SelectPlace(captured); })); body.Children.Add(Ui.Space(8)); }
        if (!places.Any()) body.Children.Add(Ui.Muted("还没有收藏的地点")); footer.Children.Add(Ui.Button("关闭", () => window.Close())); window.ShowDialog();
    }
}
