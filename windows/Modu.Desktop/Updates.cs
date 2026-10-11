using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using Modu.Core;

namespace Modu.Desktop;
public partial class MainWindow
{
    private const int CurrentVersion = 1;
    private DesktopCatalog? updateCatalog;
    private static DesktopRelease CurrentRelease() => new() { VersionCode = 1, VersionName = "0.1.0-preview", Channel = "preview", PublishedAt = "2026-10-12", Notes = "Windows 原生客户端首次推出。\n全新桌面界面、地图与列表联动、emoji 地点图标。\n公共广场、多地图、地点编辑、想去和打卡。\n照片、留言、行程、回忆、海报、回收站和 JSON 导出。\n本地缓存、键盘快捷键、深色界面与体验版更新开关。" };
    private async Task CheckUpdates(bool quiet = false)
    {
        lastUpdateCheck = DateTimeOffset.Now;
        try
        {
            updateCatalog = await api.Get<DesktopCatalog>("/windows/releases.json"); var release = updateCatalog.Latest(CurrentVersion, store.Settings.PreviewUpdates, api.BaseUrl);
            if (release == null) { if (!quiet) Notice("当前已是所选渠道的最新 Windows 版本"); return; }
            var (w, body, footer) = Dialog("有新的城市故事", $"Windows {release.VersionName} · {(release.Channel == "preview" ? "体验版" : "正式版")}", 590); body.Children.Add(Ui.Text(release.Notes, 13)); var progress = Ui.Muted(""); body.Children.Add(Ui.Space(14)); body.Children.Add(progress);
            Button download = null!; download = Ui.Button("下载并更新", () => _ = Install(), true); footer.Children.Add(download);
            async Task Install()
            {
                if (writing) return; download.IsEnabled = false; writing = true; try
                {
                    var directory = Path.Combine(store.DirectoryPath, "updates"); Directory.CreateDirectory(directory); var path = Path.Combine(directory, $"ModuExplore-{release.VersionCode}.exe"); var temporary = path + ".partial"; using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) }; using var response = await http.GetAsync(release.ExeUrl, HttpCompletionOption.ResponseHeadersRead); response.EnsureSuccessStatusCode(); if (response.RequestMessage?.RequestUri?.Scheme != "https") throw new InvalidDataException("下载地址必须使用 HTTPS"); await using (var source = await response.Content.ReadAsStreamAsync()) await using (var target = File.Create(temporary)) { byte[] buffer = new byte[65536]; long total = 0; int n; while ((n = await source.ReadAsync(buffer)) > 0) { total += n; if (total > 300 * 1024 * 1024) throw new InvalidDataException("安装包超过大小限制"); await target.WriteAsync(buffer.AsMemory(0, n)); progress.Text = $"正在下载 · {total / 1048576.0:0.0} MB"; } }
                    await UpdateIntegrity.Verify(temporary, release.Sha256); File.Move(temporary, path, true); progress.Text = "校验通过，即将重启更新";
                    var process = new ProcessStartInfo(path) { UseShellExecute = true }; process.ArgumentList.Add("--apply-update"); process.ArgumentList.Add(Environment.ProcessPath!); process.ArgumentList.Add("--waitpid"); process.ArgumentList.Add(Environment.ProcessId.ToString()); Process.Start(process); writing = false; w.Close(); Close();
                }
                catch (Exception e) { progress.Text = Error(e); }
                finally { writing = false; download.IsEnabled = true; }
            }
            w.ShowDialog();
        }
        catch (ApiException e) when (e.Status == HttpStatusCode.NotFound) { if (!quiet) Notice("Windows 在线更新尚未发布，当前为首个本地体验版"); }
        catch (Exception e) { if (!quiet) Notice("检查更新失败 · " + Error(e)); }
    }
    private void ShowHistory() { var (w, body, footer) = Dialog("更新日志", "每一次改进，都留在这里。", 700); var entries = (updateCatalog?.History(store.Settings.PreviewUpdates) ?? []).ToList(); if (entries.All(x => x.VersionCode != CurrentVersion)) entries.Insert(0, CurrentRelease()); foreach (var r in entries) { body.Children.Add(Ui.Text(r.VersionName + "  /  " + (r.Channel == "preview" ? "体验版" : "正式版"), 19, weight: FontWeights.SemiBold)); body.Children.Add(Ui.Muted(r.PublishedAt, 11)); body.Children.Add(Ui.Space(10)); body.Children.Add(Ui.Text(r.Notes, 13)); body.Children.Add(Ui.Rule()); } w.ShowDialog(); }
}
internal static class Updater
{
    public static bool Apply(string[] args)
    {
        int index = Array.IndexOf(args, "--apply-update"); if (index < 0) return false; try
        {
            if (index + 1 >= args.Length) throw new ArgumentException("更新目标缺失"); var target = Path.GetFullPath(args[index + 1]); var source = Environment.ProcessPath!; if (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || source == target) throw new ArgumentException("更新目标无效"); var pidIndex = Array.IndexOf(args, "--waitpid"); if (pidIndex >= 0 && int.TryParse(args[pidIndex + 1], out var pid)) { try { Process.GetProcessById(pid).WaitForExit(20000); } catch (ArgumentException) { } }
            for (int retry = 0; ; retry++) { try { File.Copy(source, target + ".new", true); File.Move(target + ".new", target, true); break; } catch (IOException) when (retry < 20) { Thread.Sleep(500); } }
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception e) { MessageBox.Show("更新未完成，原版本仍可使用。\n" + e.Message, "魔都 · Explore"); }
        return true;
    }
}
