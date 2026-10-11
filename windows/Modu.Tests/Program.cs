using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Modu.Core;

int passed = 0;
void Check(bool value, string label) { if (!value) throw new Exception("FAIL " + label); Console.WriteLine("PASS " + label); passed++; }
async Task Reject(Func<Task> action, string label) { try { await action(); } catch (Exception) { Check(true, label); return; } throw new Exception("FAIL " + label); }
var fixture = new Place { Id = 1, Name = "测试地点", Category = "美食", Lng = 121.4, Lat = 31.2, Emoji = "🍜" };
Check(Rules.Code(" ab12cd ") == "AB12CD" && Rules.Code("ABC") == null, "Invitation code normalization and validation");
Check(Rules.ValidEmoji("👩‍👩‍👧‍👦") && Rules.ValidEmoji("🇨🇳") && Rules.ValidEmoji("1️⃣") && !Rules.ValidEmoji("🍜🍰") && !Rules.ValidEmoji("hello"), "Emoji validates complete grapheme clusters");
Check(Rules.Filter([fixture, fixture with { Id = 2, Name = "公园", Category = "景点", Visited = true }], "", "景点", true, 0).Count() == 0, "Category and visited filters intersect");
Check(Rules.Filter([fixture], "测试", "全部", false, 0).Single().Id == 1, "Search matches stored place name");
Check(Rules.Distance(fixture, fixture) == 0 && Rules.Distance(fixture, fixture with { Lat = 32 }) > 80, "Distance calculation bounds");
Check(Rules.ParseShare("https://uri.amap.com/marker?position=121.4,31.2&name=%E6%B5%8B%E8%AF%95")?.Name == "测试" && Rules.ParseShare("位置：200,31") == null, "Share import decodes valid coordinates and rejects invalid coordinates");
Check(Rules.Navigation(fixture).Query.Contains("mode=walk"), "Navigation uses GCJ-02 walking endpoint");
await Reject(() => { Rules.Validate(fixture with { Lng = double.NaN }); return Task.CompletedTask; }, "Non-finite coordinates rejected");
await Reject(() => { Rules.Validate(fixture with { Name = "" }); return Task.CompletedTask; }, "Empty place names rejected");
var directory = Path.Combine(Path.GetTempPath(), "modu-tests-" + Guid.NewGuid().ToString("N")); var local = new LocalStore(directory); local.Remember(new("ABC123", "测试地图")); local.Cache("ABC123", [fixture]); var reread = new LocalStore(directory); Check(reread.Settings.Maps.Count == 1 && reread.Cached("ABC123").Count == 1, "Preferences and cached places survive restart"); local.Remember(new("DEF456", "新名称"), "ABC123"); Check(local.Settings.Maps.Count == 1 && local.Settings.SelectedCode == "DEF456", "Rekey replaces old invitation reference"); local.Forget("DEF456"); Check(local.Settings.SelectedCode == null && local.Settings.Maps.Count == 0, "Forget resets current selection"); await File.WriteAllTextAsync(Path.Combine(directory, "settings.json"), "corrupt"); Check(new LocalStore(directory).Settings.Maps.Count == 0, "Corrupt local preferences recover safely");
var handler = new FakeHandler(); using (var fake = new MapApi("https://test.example", handler))
{
    handler.Callback = request => { Check(request.Headers.GetValues("x-map-code").Single() == "ABC123", "Authenticated writes carry map header"); return new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(fixture, Wire.Json)) }; }; await fake.Save("ABC123", fixture);
    int attempts = 0; handler.Callback = request => { attempts++; throw new HttpRequestException("offline"); }; await Reject(() => fake.Raw("POST", "/api/maps", new { name = "x" }), "Ambiguous POST failure is surfaced"); Check(attempts == 1, "Non-idempotent writes are never retried automatically");
    attempts = 0; handler.Callback = request => { if (attempts++ == 0) throw new HttpRequestException("offline"); return new(HttpStatusCode.OK) { Content = new StringContent("{}") }; }; await fake.Raw("GET", "/api/health"); Check(attempts == 2, "Read requests retry once after transport error");
    handler.Callback = request => new(HttpStatusCode.BadRequest) { Content = new StringContent("{\"error\":\"名称不能为空\"}") }; try { await fake.Raw("GET", "/error"); } catch (ApiException e) { Check(e.Message == "名称不能为空", "API errors preserve actionable server message"); }
    handler.Callback = request => new(HttpStatusCode.Created) { Content = new StringContent("{\"code\":\"ABC123\",\"name\":\"x\"}") }; await fake.Create("x", "署名"); Check(handler.Body!.Contains("createdBy") && !handler.Body.Contains("created_by"), "Map creation uses legacy camel-case author contract");
}
var hash = new string('a', 64); var stable = new DesktopRelease { VersionCode = 2, VersionName = "0.2", Channel = "stable", ExeUrl = "https://test.example/windows/a.exe", Sha256 = hash }; var preview = stable with { VersionCode = 3, Channel = "preview" }; var catalog = new DesktopCatalog([stable, preview]); Check(catalog.Latest(1, false, "https://test.example") == stable && catalog.Latest(1, true, "https://test.example") == preview, "Preview releases require opt-in"); Check(!stable.Valid("https://evil.example"), "Executable downloads reject unrelated origins"); var exe = Path.Combine(directory, "verify.exe"); await File.WriteAllBytesAsync(exe, Encoding.ASCII.GetBytes("MZtest")); var digest = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(exe))); await UpdateIntegrity.Verify(exe, digest); Check(true, "Update binary SHA256 integrity verification"); await Reject(() => UpdateIntegrity.Verify(exe, hash), "Tampered update executable rejected");
if (args.Length > 0)
{
    using var api = new MapApi(args[0]); var map = await api.Create("Windows 自动化隔离测试", "desktop-tests"); Check(map.CreatedBy == "desktop-tests", "Create map author survives server contract");
    try
    {
        var p = await api.Save(map.Code, fixture with { Id = 0 }, true); Check(p.Id > 0 && p.Emoji == "🍜", "Create place persists emoji and coordinates"); p = await api.Save(map.Code, p with { Name = "更新后的地点", Emoji = "☕" }); Check(p.Name == "更新后的地点" && p.Emoji == "☕", "Edit place persists fields");
        Check((await api.Places(map.Code)).Count == 1, "Private place list reads created data"); Check((await api.Wish(map.Code, p.Id, "tester")).Contains("tester"), "Wish toggle adds nickname"); Check((await api.Wish(map.Code, p.Id, "tester")).Count == 0, "Wish toggle removes nickname");
        p = await api.Visit(map.Code, p); Check(p.Visited && (await api.Memories(map.Code)).Count == 1, "Visited state contributes to memories");
        var comment = await api.Comment(map.Code, p.Id, "隔离测试留言", "tester"); Check((await api.Comments(map.Code, p.Id)).Single().Body == comment.Body, "Comment create and read"); await api.DeleteComment(map.Code, comment.Id); Check((await api.Comments(map.Code, p.Id)).Count == 0, "Comment deletion");
        const string png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        var photo = await api.Upload(map.Code, p.Id, png, png, "tester"); Check((await api.Photos(map.Code, p.Id)).Count == 1, "Photo upload and thumbnail read"); await api.DeletePhoto(map.Code, photo); Check((await api.Photos(map.Code, p.Id)).Count == 0, "Photo deletion");
        var second = await api.Save(map.Code, fixture with { Id = 0, Name = "第二站", Lng = 121.5 }, true); var itinerary = await api.SaveItinerary(map.Code, [second.Id, p.Id]); Check(itinerary[0].Id == second.Id && (await api.Itinerary(map.Code)).Count == 2, "Itinerary order persists");
        Check(await api.Publish(map.Code, p.Id) && (await api.Places(null)).Any(x => x.Id == p.Id), "Public publishing exposes place without invitation"); await api.Report(null, p.Id, "其他问题", "tester"); Check(true, "Public report submits without private invitation"); await api.Publish(map.Code, p.Id);
        var exported = await api.Raw("GET", $"/api/maps/{map.Code}/export"); Check(exported.Contains("更新后的地点"), "JSON export includes current places"); await api.DeletePlace(map.Code, p.Id); Check((await api.Places(map.Code, true)).Count == 1, "Soft deletion moves place to trash"); await api.Restore(map.Code, p.Id); Check((await api.Places(map.Code)).Count == 2, "Trash restore recovers place");
        var renamed = await api.Write<ExploreMap>("PUT", $"/api/maps/{map.Code}", new { name = "改名地图" }); Check(renamed.Name == "改名地图", "Map rename"); var old = map.Code; map = await api.Write<ExploreMap>("POST", $"/api/maps/{old}/rekey"); Check(map.Code != old, "Map invitation rekey"); await Reject(() => api.Map(old), "Old invitation stops working after rekey");
    }
    finally { await api.Raw("DELETE", $"/api/maps/{map.Code}"); }
    await Reject(() => api.Map(map.Code), "Map deletion removes server data");
}
Console.WriteLine($"ALL {passed} CHECKS PASSED");
sealed class FakeHandler : HttpMessageHandler
{
    public Func<HttpRequestMessage, HttpResponseMessage> Callback { get; set; } = request => new(HttpStatusCode.OK);
    public string? Body { get; private set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) { Body = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct); return Callback(request); }
}
