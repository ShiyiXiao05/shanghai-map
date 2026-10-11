using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Modu.Core;

public static class Wire
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true, WriteIndented = true };
}
public record ExploreMap(string Code, string Name, string CreatedBy = "");
public record Place
{
    public long Id { get; init; }
    public string Name { get; init; } = "";
    public string Category { get; init; } = "景点";
    public double Lng { get; init; }
    public double Lat { get; init; }
    public string Address { get; init; } = "";
    public string Description { get; init; } = "";
    public string AddedBy { get; init; } = "";
    public string CreatedAt { get; init; } = "";
    public string? VisitedAt { get; init; }
    public string? DeletedAt { get; init; }
    public bool Visited { get; init; }
    public bool IsPublic { get; init; }
    public string PriceHint { get; init; } = "";
    public string Hours { get; init; } = "";
    public string Tags { get; init; } = "";
    public string Emoji { get; init; } = "";
    public int PhotoCount { get; init; }
    public int CommentCount { get; init; }
    public List<string> Wishes { get; init; } = [];
    public string DisplayEmoji => string.IsNullOrWhiteSpace(Emoji) ? Rules.Emoji(Category) : Emoji;
}
public record Photo(long Id, string Thumb = "", string? Full = null, string AddedBy = "");
public record Comment(long Id, string Body, string Author = "", string CreatedAt = "");
public record Memory(long Id, string Name, string Category, string Address = "", string? VisitedAt = null, List<string>? Photos = null);
public record PickedPoint(string Name, string Address, double Lng, double Lat);
public record PlacesResponse(List<Place> Places);
public record PhotosResponse(List<Photo> Photos);
public record CommentsResponse(List<Comment> Comments);
public record StopsResponse(List<Place> Stops);
public record MemoriesResponse(List<Memory> Memories);
public record MapConfiguration(string Key, [property: System.Text.Json.Serialization.JsonPropertyName("securityJsCode")] string SecurityJsCode);

public static class Rules
{
    public static readonly string[] Categories = ["景点", "美食", "展馆", "购物", "娱乐", "其他"];
    public static string Emoji(string category) => category switch { "景点" => "🏞️", "美食" => "🍜", "展馆" => "🏛️", "购物" => "🛍️", "娱乐" => "🎡", _ => "📍" };
    public static string? Code(string input) => Regex.IsMatch(input.Trim().ToUpperInvariant(), "^[A-Z0-9]{6}$") ? input.Trim().ToUpperInvariant() : null;
    public static bool ValidEmoji(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (value.Length > 32 || StringInfo.ParseCombiningCharacters(value).Length != 1) return false;
        int first = Rune.GetRuneAt(value, 0).Value;
        return first is >= 0x1F000 and <= 0x1FAFF or >= 0x2300 and <= 0x27FF or 0xA9 or 0xAE or 0x3030 or 0x303D or 0x3297 or 0x3299 ||
            (first is >= 48 and <= 57 or 35 or 42) && value.Contains('\u20E3');
    }
    public static void Validate(Place place)
    {
        if (string.IsNullOrWhiteSpace(place.Name) || place.Name.Length > 100) throw new ArgumentException("地点名称需要 1–100 个字");
        if (!Categories.Contains(place.Category)) throw new ArgumentException("请选择有效分类");
        if (!double.IsFinite(place.Lng) || !double.IsFinite(place.Lat) || Math.Abs(place.Lng) > 180 || Math.Abs(place.Lat) > 90) throw new ArgumentException("请输入有效经纬度");
        if (!ValidEmoji(place.Emoji)) throw new ArgumentException("请输入一个 emoji，或留空使用分类默认图标");
        if (place.Description.Length > 500 || place.Address.Length > 200 || place.PriceHint.Length > 50 || place.Hours.Length > 100 || place.Tags.Length > 100) throw new ArgumentException("地点信息超出长度限制");
    }
    public static IEnumerable<Place> Filter(IEnumerable<Place> places, string query, string category, bool unvisited, int sort) {
        var selected = places.Where(p => (category == "全部" || category == p.Category) && (!unvisited || !p.Visited) &&
            (p.Name + " " + p.Address + " " + p.Tags).Contains(query, StringComparison.OrdinalIgnoreCase));
        return sort switch { 1 => selected.OrderBy(p => p.Name, StringComparer.CurrentCulture), 2 => selected.OrderByDescending(p => p.Wishes.Count).ThenByDescending(p => p.Id), _ => selected.OrderByDescending(p => p.Id) };
    }
    public static double Distance(Place a, Place b) {
        double r = Math.PI / 180, x = Math.Pow(Math.Sin((a.Lat-b.Lat)*r/2),2) + Math.Cos(a.Lat*r)*Math.Cos(b.Lat*r)*Math.Pow(Math.Sin((a.Lng-b.Lng)*r/2),2);
        return 6371 * 2 * Math.Asin(Math.Sqrt(Math.Clamp(x,0,1)));
    }
    public static string DistanceText(double km) => km < 1 ? $"{km*1000:0} m" : $"{km:0.0} km";
    public static string RouteText(IReadOnlyList<Place> stops) {
        var km = stops.Zip(stops.Skip(1)).Sum(pair => Distance(pair.First, pair.Second));
        return stops.Count < 2 ? "添加至少两个地点，开始规划" : $"{stops.Count} 站 · 直线距离 {DistanceText(km)} · 步行估算 {Math.Max(1, Math.Round(km/4.5*60))} 分钟";
    }
    public static PickedPoint? ParseShare(string text) {
        var match = Regex.Match(text, @"(?:position=|位置[：:]\s*)(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)");
        if (!match.Success || !double.TryParse(match.Groups[1].Value, CultureInfo.InvariantCulture, out var lng) || !double.TryParse(match.Groups[2].Value, CultureInfo.InvariantCulture, out var lat) || Math.Abs(lng)>180 || Math.Abs(lat)>90) return null;
        var name = Regex.Match(text, @"[?&]name=([^&\s]+)");
        return new(name.Success ? Uri.UnescapeDataString(name.Groups[1].Value.Replace("+"," ")) : Regex.Match(text,@"【([^】]+)】").Groups[1].Value, "", lng, lat);
    }
    public static Uri Navigation(Place p) => new($"https://uri.amap.com/navigation?to={p.Lng.ToString(CultureInfo.InvariantCulture)},{p.Lat.ToString(CultureInfo.InvariantCulture)},{Uri.EscapeDataString(p.Name)}&mode=walk&coordinate=gaode&callnative=1&src=modu-explore");
    public static Uri RouteNavigation(Place from,Place to) => new($"https://uri.amap.com/navigation?from={from.Lng.ToString(CultureInfo.InvariantCulture)},{from.Lat.ToString(CultureInfo.InvariantCulture)},{Uri.EscapeDataString(from.Name)}&to={to.Lng.ToString(CultureInfo.InvariantCulture)},{to.Lat.ToString(CultureInfo.InvariantCulture)},{Uri.EscapeDataString(to.Name)}&mode=walk&coordinate=gaode&src=modu-explore");
}
