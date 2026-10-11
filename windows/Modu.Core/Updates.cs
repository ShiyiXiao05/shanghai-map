using System.Security.Cryptography;
using System.Text.Json.Serialization;

namespace Modu.Core;
public record DesktopRelease {
    [JsonPropertyName("versionCode")] public int VersionCode { get; init; }
    [JsonPropertyName("versionName")] public string VersionName { get; init; } = "";
    public string Channel { get; init; } = "stable";
    [JsonPropertyName("publishedAt")] public string PublishedAt { get; init; } = "";
    [JsonPropertyName("exeUrl")] public string ExeUrl { get; init; } = "";
    public string Sha256 { get; init; } = "";
    public string Notes { get; init; } = "";
    public bool Valid(string origin)=> VersionCode>0 && !string.IsNullOrWhiteSpace(VersionName) && Channel is "stable" or "preview" &&
        Uri.TryCreate(ExeUrl,UriKind.Absolute,out var uri) && uri.Scheme=="https" && uri.UserInfo=="" && uri.GetLeftPart(UriPartial.Authority)==new Uri(origin).GetLeftPart(UriPartial.Authority) &&
        Sha256.Length==64 && Sha256.All(Uri.IsHexDigit);
}
public record DesktopCatalog(List<DesktopRelease> Releases) {
    public DesktopRelease? Latest(int current,bool preview,string origin)=>Releases.Where(r=>r.VersionCode>current&&(r.Channel=="stable"||preview)&&r.Valid(origin)).MaxBy(r=>r.VersionCode);
    public IEnumerable<DesktopRelease> History(bool preview)=>Releases.Where(r=>r.Channel=="stable"||preview&&r.Channel=="preview").DistinctBy(r=>r.VersionCode).OrderByDescending(r=>r.VersionCode);
}
public static class UpdateIntegrity {
    public static async Task Verify(string path,string hash,CancellationToken ct=default) {
        await using var file=File.OpenRead(path);byte[] prefix=new byte[2];if(await file.ReadAsync(prefix,ct)!=2||prefix[0]!='M'||prefix[1]!='Z')throw new InvalidDataException("下载文件不是 Windows 可执行程序");file.Position=0;
        var actual=Convert.ToHexString(await SHA256.HashDataAsync(file,ct));if(!actual.Equals(hash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("安装包校验失败，请重新下载");
    }
}
