using System.Net;
using System.Text;
using System.Text.Json;

namespace Modu.Core;
public sealed class ApiException(HttpStatusCode status, string message) : Exception(message) { public HttpStatusCode Status { get; } = status; }
public sealed class MapApi : IDisposable
{
    private readonly HttpClient http;
    public string BaseUrl { get; }
    public MapApi(string baseUrl = "https://shanghai-wish-map.onrender.com", HttpMessageHandler? handler = null) {
        var uri = new Uri(baseUrl);
        if (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) throw new ArgumentException("服务器需要使用 HTTPS");
        BaseUrl = baseUrl.TrimEnd('/'); http = handler == null ? new() : new(handler);
        http.Timeout = TimeSpan.FromSeconds(75);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("ModuExplore-Windows/0.1.0");
    }
    public async Task<string> Raw(string method, string path, object? body = null, string? code = null, CancellationToken ct = default) {
        for (int attempt=0;;attempt++) {
            using var request = new HttpRequestMessage(new HttpMethod(method), BaseUrl+path);
            if (body != null) request.Content = new StringContent(JsonSerializer.Serialize(body, Wire.Json), Encoding.UTF8, "application/json");
            else if (method is "PUT" or "POST") request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
            if (code != null) request.Headers.Add("x-map-code",code);
            try {
                using var response = await http.SendAsync(request,ct);
                var text = await response.Content.ReadAsStringAsync(ct);
                if (!response.IsSuccessStatusCode) {
                    string message=$"请求失败（{(int)response.StatusCode}）";
                    try { message = JsonDocument.Parse(text).RootElement.GetProperty("error").GetString() ?? message; } catch (JsonException) {} catch (KeyNotFoundException) {}
                    throw new ApiException(response.StatusCode,message);
                }
                return text;
            } catch (HttpRequestException) when (method=="GET" && attempt==0 && !ct.IsCancellationRequested) { await Task.Delay(250,ct); }
        }
    }
    public async Task<T> Get<T>(string path, CancellationToken ct = default) => JsonSerializer.Deserialize<T>(await Raw("GET",path,ct:ct),Wire.Json) ?? throw new JsonException("服务器返回为空");
    public async Task<T> Write<T>(string method,string path,object? body=null,string? code=null,CancellationToken ct=default) => JsonSerializer.Deserialize<T>(await Raw(method,path,body,code,ct),Wire.Json) ?? throw new JsonException("服务器返回为空");
    public async Task<List<Place>> Places(string? code, bool trash=false, CancellationToken ct=default) => (await Get<PlacesResponse>(code==null?"/api/public/places":$"/api/places?map={Uri.EscapeDataString(code)}{(trash?"&view=trash":"")}",ct)).Places;
    public Task<ExploreMap> Map(string code,CancellationToken ct=default) => Get<ExploreMap>($"/api/maps/{Uri.EscapeDataString(code)}",ct);
    public Task<ExploreMap> Create(string name,string nickname) => Write<ExploreMap>("POST","/api/maps",new Dictionary<string,object> { ["name"]=name,["createdBy"]=nickname });
    public Task<Place> Save(string code,Place p,bool create=false) {
        Rules.Validate(p);
        return Write<Place>(create?"POST":"PUT",create?"/api/places":$"/api/places/{p.Id}",new { map_code=code, p.Name,p.Category,p.Lng,p.Lat,p.Address,p.Description,p.Emoji,p.PriceHint,p.Hours,p.Tags,p.AddedBy },code);
    }
    public Task<Place> Visit(string code,Place p) => Write<Place>("PUT",$"/api/places/{p.Id}",new { visited=!p.Visited },code);
    public async Task<List<string>> Wish(string code,long id,string nickname) => (await Write<JsonElement>("POST",$"/api/places/{id}/wish",new { map_code=code, who=nickname })).GetProperty("wishes").Deserialize<List<string>>(Wire.Json)!;
    public async Task<bool> Publish(string code,long id) => (await Write<JsonElement>("POST",$"/api/places/{id}/public",new { map_code=code })).GetProperty("is_public").GetBoolean();
    public async Task<List<Photo>> Photos(string code,long id,CancellationToken ct=default) => (await Get<PhotosResponse>($"/api/places/{id}/photos?map={code}",ct)).Photos;
    public async Task<List<Comment>> Comments(string code,long id,CancellationToken ct=default) => (await Get<CommentsResponse>($"/api/places/{id}/comments?map={code}",ct)).Comments;
    public Task<Comment> Comment(string code,long id,string body,string nickname) => Write<Comment>("POST",$"/api/places/{id}/comments",new { map_code=code, body, author=nickname });
    public async Task<long> Upload(string code,long id,string full,string thumb,string nickname) => (await Write<JsonElement>("POST",$"/api/places/{id}/photos",new { map_code=code, full,thumb,added_by=nickname })).GetProperty("id").GetInt64();
    public async Task<List<Place>> Itinerary(string code,CancellationToken ct=default) => (await Get<StopsResponse>($"/api/itinerary?map={code}",ct)).Stops;
    public async Task<List<Place>> SaveItinerary(string code,List<long> ids) => (await Write<StopsResponse>("PUT","/api/itinerary",new { map_code=code, place_ids=ids })).Stops;
    public async Task<List<Memory>> Memories(string code,CancellationToken ct=default) => (await Get<MemoriesResponse>($"/api/maps/{code}/memories",ct)).Memories;
    public Task DeletePlace(string code,long id) => Raw("DELETE",$"/api/places/{id}",code:code);
    public Task Restore(string code,long id) => Raw("POST",$"/api/places/{id}/restore",new { map_code=code });
    public Task DeletePhoto(string code,long id) => Raw("DELETE",$"/api/photos/{id}",code:code);
    public Task DeleteComment(string code,long id) => Raw("DELETE",$"/api/comments/{id}",code:code);
    public Task Report(string? code,long id,string reason,string nickname) => Raw("POST","/api/reports",new { map_code=code, target_type="place",target_id=id,reason,reporter=nickname });
    public void Dispose() => http.Dispose();
}
