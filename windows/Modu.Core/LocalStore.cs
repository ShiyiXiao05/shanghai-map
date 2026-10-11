using System.Text.Json;

namespace Modu.Core;
public record Preferences {
    public string Nickname { get; set; } = "";
    public string? SelectedCode { get; set; }
    public List<ExploreMap> Maps { get; set; } = [];
    public bool MapConsent { get; set; }
    public bool PreviewUpdates { get; set; }
    public bool Dark { get; set; }
    public string ThemeMode { get; set; } = "system";
}
public sealed class LocalStore
{
    public string DirectoryPath { get; }
    public Preferences Settings { get; private set; } = new();
    public LocalStore(string? path = null) {
        DirectoryPath = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ModuExplore");
        Directory.CreateDirectory(DirectoryPath);
        try { Settings = JsonSerializer.Deserialize<Preferences>(File.ReadAllText(Path.Combine(DirectoryPath,"settings.json")),Wire.Json) ?? new(); }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) {}
    }
    private void Atomic(string filename,object value) {
        var target=Path.Combine(DirectoryPath,filename); var temp=target+".tmp";
        File.WriteAllText(temp,JsonSerializer.Serialize(value,Wire.Json)); File.Move(temp,target,true);
    }
    public void Save() => Atomic("settings.json",Settings);
    public void Remember(ExploreMap map,string? previous=null) {
        Settings.Maps.RemoveAll(m=>m.Code==map.Code||m.Code==previous); Settings.Maps.Add(map); Settings.SelectedCode=map.Code; Save();
    }
    public void Forget(string code) {
        Settings.Maps.RemoveAll(m=>m.Code==code); if(Settings.SelectedCode==code) Settings.SelectedCode=null; Save();
        var cache=Path.Combine(DirectoryPath,$"places-{Rules.Code(code) ?? "public"}.json"); if(File.Exists(cache)) File.Delete(cache);
    }
    public void Cache(string? code,List<Place> places) => Atomic($"places-{(code==null?"public":Rules.Code(code)??throw new ArgumentException("邀请码格式错误"))}.json",places);
    public List<Place> Cached(string? code) {
        try { return JsonSerializer.Deserialize<List<Place>>(File.ReadAllText(Path.Combine(DirectoryPath,$"places-{(code==null?"public":Rules.Code(code)??"invalid")}.json")),Wire.Json) ?? []; }
        catch(Exception error) when(error is IOException or JsonException or UnauthorizedAccessException) { return []; }
    }
}
