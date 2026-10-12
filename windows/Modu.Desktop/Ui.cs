using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace Modu.Desktop;
internal static class Ui
{
    public const double CaptionSize = 12, BodySize = 13, SectionSize = 18, HeroSize = 24, PageSize = 30;
    public const double CardGap = 24, ControlGap = 12;
    public static Brush Brush(string color) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
    public static void Resource(FrameworkElement target, DependencyProperty property, string name) => target.SetResourceReference(property, name);
    public static TextBlock Text(string text, double size = 13, string? color = null, FontWeight? weight = null)
    {
        size = size switch { 10 or 11 => CaptionSize, 15 or 16 or 17 or 19 => SectionSize, 22 or 23 or 25 or 26 or 27 or 28 => HeroSize, _ => size };
        var block = new TextBlock { Text = text, FontSize = size, FontWeight = weight ?? FontWeights.Normal, LineHeight = size * 1.5, TextWrapping = TextWrapping.Wrap };
        if (color != null) block.Foreground = Brush(color); return block;
    }
    public static TextBlock Muted(string text, double size = 12) { var b = Text(text, size); Resource(b, TextBlock.ForegroundProperty, "Muted"); return b; }
    public static Button Button(string text, Action action, bool primary = false, string? hint = null)
    {
        var b = new Button { Style = (Style)Application.Current.FindResource(primary ? "Primary" : typeof(Button)), ToolTip = hint ?? text };
        var label = new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center, TextAlignment = TextAlignment.Center }; label.SetBinding(TextBlock.FontSizeProperty, new System.Windows.Data.Binding("FontSize") { Source = b }); label.SetBinding(TextBlock.ForegroundProperty, new System.Windows.Data.Binding("Foreground") { Source = b }); b.Content = label;
        AutomationProperties.SetName(b, hint ?? text); b.Click += (_, _) => action(); return b;
    }
    public static Button Quiet(string text, Action action, string? hint = null) { var b = Button(text, action, hint: hint); b.Style = (Style)Application.Current.FindResource("Quiet"); return b; }
    public static TextBox Input(string name, string value = "", int max = 0, bool multi = false)
    {
        var box = new TextBox { Text = value, ToolTip = name, Tag = name, MaxLength = max, AcceptsReturn = multi, TextWrapping = multi ? TextWrapping.Wrap : TextWrapping.NoWrap, MinHeight = multi ? 100 : 44, VerticalContentAlignment = multi ? VerticalAlignment.Top : VerticalAlignment.Center };
        AutomationProperties.SetName(box, name); return box;
    }
    public static StackPanel Column(params UIElement[] elements) { var p = new StackPanel(); foreach (var e in elements) p.Children.Add(e); return p; }
    public static StackPanel Row(params UIElement[] elements) { var p = new StackPanel { Orientation = Orientation.Horizontal }; for (int i = 0; i < elements.Length; i++) { if (elements[i] is FrameworkElement f) { f.Margin = new Thickness(0, 0, i == elements.Length - 1 ? 0 : ControlGap, 0); f.VerticalAlignment = VerticalAlignment.Center; } p.Children.Add(elements[i]); } return p; }
    public static WrapPanel Wrap(params UIElement[] elements) { var p = new WrapPanel(); foreach (var e in elements) { if (e is FrameworkElement f) f.Margin = new Thickness(0, 0, ControlGap, ControlGap); p.Children.Add(e); } return p; }
    public static Border Card(UIElement child, Thickness? padding = null, double radius = 18)
    {
        var b = new Border { Child = child, Padding = padding ?? new Thickness(22), CornerRadius = new CornerRadius(radius), BorderThickness = new Thickness(1) };
        Resource(b, Border.BackgroundProperty, "Surface"); Resource(b, Border.BorderBrushProperty, "Line"); return b;
    }
    public static Border Rule() { var b = new Border { Height = 1, Margin = new Thickness(0, 16, 0, 16) }; Resource(b, Border.BackgroundProperty, "Line"); return b; }
    public static FrameworkElement Space(double height = 16) => new Border { Height = height };
    public static StackPanel Field(string label, FrameworkElement input, string? hint = null) { var p = Column(Muted(label, 12), Space(6), input, Space(14)); if (hint != null) p.Children.Insert(3, Muted(hint, 11)); return p; }
    public static Image Avatar(double size = 44) => new() { Width = size, Height = size, Stretch = Stretch.UniformToFill, Source = new BitmapImage(new Uri("pack://application:,,,/Assets/avatar.png")), Clip = new EllipseGeometry(new Point(size / 2, size / 2), size / 2, size / 2) };
    public static Border Badge(string text, string? color = null)
    {
        var b = new Border { Padding = new Thickness(9, 4, 9, 4), CornerRadius = new CornerRadius(7), Child = Text(text, 11, color), Margin = new Thickness(0, 0, 7, 7) }; Resource(b, Border.BackgroundProperty, "Tint"); return b;
    }
    public static TextBlock Eyebrow(string text) { var b = Muted(text, CaptionSize); b.FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI"); b.FontWeight = FontWeights.Medium; b.VerticalAlignment = VerticalAlignment.Center; return b; }
    public static Button Action(string icon, string text, Action action, bool primary = false, string? hint = null)
    {
        var b = Button(text, action, primary, hint); var glyph = Icon(icon, 16);
        glyph.SetBinding(Shape.StrokeProperty, new System.Windows.Data.Binding("Foreground") { Source = b });
        var label = Text(text, BodySize); label.SetBinding(TextBlock.FontSizeProperty, new System.Windows.Data.Binding("FontSize") { Source = b }); label.SetBinding(TextBlock.ForegroundProperty, new System.Windows.Data.Binding("Foreground") { Source = b });
        var row = Row(glyph, label); glyph.Margin = new Thickness(0, 0, 8, 0); label.Margin = new Thickness(0); row.HorizontalAlignment = HorizontalAlignment.Center; b.Content = row; return b;
    }
    public static Button IconAction(string icon, Action action, string hint)
    {
        var b = Action(icon, "", action, hint: hint); var glyph = Icon(icon, 16); Ui.Resource(glyph, Shape.StrokeProperty, "Ink"); b.Content = glyph; b.Width = 36; b.MinHeight = 36; b.Height = 36; b.Padding = new Thickness(0); b.BorderThickness = new Thickness(0); Ui.Resource(b, Control.BackgroundProperty, "Tint"); return b;
    }
    public static Grid Pair(UIElement first, UIElement second, double gap = ControlGap)
    {
        var g = new Grid(); g.ColumnDefinitions.Add(new()); g.ColumnDefinitions.Add(new() { Width = new GridLength(gap) }); g.ColumnDefinitions.Add(new()); g.Children.Add(first); Grid.SetColumn(second, 2); g.Children.Add(second); g.Margin = new Thickness(0, 0, 0, ControlGap); return g;
    }
    public static Grid SectionHeading(string text, UIElement? action = null)
    {
        var g = new Grid { Margin = new Thickness(0, 0, 0, 12) }; g.ColumnDefinitions.Add(new()); g.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); var title = Text(text, SectionSize, weight: FontWeights.SemiBold); title.VerticalAlignment = VerticalAlignment.Center; g.Children.Add(title); if (action != null) { Grid.SetColumn(action, 1); g.Children.Add(action); } return g;
    }
    public static Border Emblem()
    {
        var b = new Border { Width = 36, Height = 40, CornerRadius = new CornerRadius(12), Background = Brush("#294E45"), Child = Icon("pin", 21, Brush("#F3D0B7")) }; b.VerticalAlignment = VerticalAlignment.Center; return b;
    }
    public static (string Fill, string Ink) CategoryColors(string category) => category switch
    {
        "美食" => ("#F9EEE2", "#B9874C"), "展馆" => ("#EDECF6", "#8B7DA7"), "娱乐" => ("#F8EDEB", "#B77D74"), _ => ("#E7F0EB", "#648B7A")
    };
    public static Border PlaceSymbol(Modu.Core.Place p, double size)
    {
        var colors = CategoryColors(p.Category); var symbol = Text(p.DisplayEmoji, size * .52, colors.Ink); symbol.FontFamily = new FontFamily("Segoe UI Emoji"); symbol.HorizontalAlignment = HorizontalAlignment.Center; symbol.VerticalAlignment = VerticalAlignment.Center;
        return new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size * .29), Background = Brush(colors.Fill), Child = symbol };
    }
    public static Border PlaceCover(Modu.Core.Place p)
    {
        var colors = CategoryColors(p.Category);
        var canvas = new Canvas { Width = 280, Height = 118, ClipToBounds = true };
        foreach (var data in new[] { "M-20,35 L300,150", "M30,-10 L170,140", "M120,-20 L50,140", "M230,-20 L150,140" }) canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse(data), Stroke = Brush("#FFFFFF"), StrokeThickness = 10, Opacity = .7 });
        var ring = new Ellipse { Width = 84, Height = 84, Stroke = Brush(colors.Ink), StrokeThickness = 1, Opacity = .15 }; Canvas.SetLeft(ring, 165); Canvas.SetTop(ring, 17); canvas.Children.Add(ring);
        var symbol = PlaceSymbol(p, 60); symbol.Background = Brushes.White; Canvas.SetLeft(symbol, 177); Canvas.SetTop(symbol, 29); canvas.Children.Add(symbol);
        var label = Text("CITY\nCOLLECTION", 11, colors.Ink, FontWeights.SemiBold); label.FontFamily = new FontFamily("Segoe UI"); Canvas.SetLeft(label, 18); Canvas.SetTop(label, 45); canvas.Children.Add(label);
        return new Border { Background = Brush(colors.Fill), CornerRadius = new CornerRadius(14), Height = 118, Child = new Viewbox { Stretch = Stretch.Fill, Child = canvas }, ClipToBounds = true };
    }
    public static System.Windows.Shapes.Path Icon(string name, double size = 18, Brush? brush = null)
    {
        var paths = new Dictionary<string, string>
        {
            ["explore"] = "M12,2 A10,10 0 1 0 12,22 A10,10 0 1 0 12,2 M16,8 L14,14 L8,16 L10,10 Z",
            ["pin"] = "M12,22 C10,19 4,13 4,9 A8,8 0 1 1 20,9 C20,13 14,19 12,22 Z M12,6 A3,3 0 1 0 12,12 A3,3 0 1 0 12,6",
            ["public"] = "M12,2 A10,10 0 1 0 12,22 A10,10 0 1 0 12,2 M2,12 L22,12 M12,2 C6,7 6,17 12,22 M12,2 C18,7 18,17 12,22",
            ["plus"] = "M12,4 L12,20 M4,12 L20,12",
            ["refresh"] = "M20,10 A8,8 0 1 0 20,16 M20,3 L20,10 L13,10",
            ["focus"] = "M9,3 L3,3 L3,9 M15,3 L21,3 L21,9 M3,15 L3,21 L9,21 M21,15 L21,21 L15,21 M12,8 A4,4 0 1 0 12,16 A4,4 0 1 0 12,8",
            ["locate"] = "M12,4 A8,8 0 1 0 12,20 A8,8 0 1 0 12,4 M12,1 L12,6 M12,18 L12,23 M1,12 L6,12 M18,12 L23,12 M12,9 A3,3 0 1 0 12,15 A3,3 0 1 0 12,9",
            ["expand"] = "M3,9 L3,3 L9,3 M15,3 L21,3 L21,9 M21,15 L21,21 L15,21 M9,21 L3,21 L3,15",
            ["shuffle"] = "M3,6 L6,6 C12,6 12,18 18,18 L21,18 M18,15 L21,18 L18,21 M3,18 L6,18 C9,18 10,16 11,14 M13,10 C15,6 16,6 21,6 M18,3 L21,6 L18,9",
            ["arrow"] = "M5,19 L19,5 M5,5 L19,5 L19,19",
            ["close"] = "M5,5 L19,19 M5,19 L19,5",
            ["route"] = "M5,5 A3,3 0 1 0 5,5.1 M19,19 A3,3 0 1 0 19,19.1 M5,8 L5,14 Q5,18 11,12 Q19,5 19,16",
            ["memory"] = "M3,7 L21,7 L21,20 L3,20 Z M8,7 L9,4 L15,4 L16,7 M16,13 A4,4 0 1 0 16,13.1",
            ["maps"] = "M2,5 L8,3 L16,6 L22,3 L22,20 L16,22 L8,19 L2,22 Z M8,3 L8,19 M16,6 L16,22",
            ["trash"] = "M4,6 L20,6 M9,6 L9,3 L15,3 L15,6 M6,6 L7,21 L17,21 L18,6 M10,10 L10,17 M14,10 L14,17",
            ["settings"] = "M12,8 A4,4 0 1 0 12,16 A4,4 0 1 0 12,8 M12,2 L12,5 M12,19 L12,22 M2,12 L5,12 M19,12 L22,12 M5,5 L7,7 M17,17 L19,19 M19,5 L17,7 M7,17 L5,19",
            ["poster"] = "M4,3 L20,3 L20,21 L4,21 Z M7,16 L11,12 L14,15 L17,10 M8,8 A1,1 0 1 0 8,8.1",
            ["history"] = "M3,10 A9,9 0 1 1 3,16 M3,3 L3,10 L9,10 M12,7 L12,13 L16,15",
        };
        var icon = new System.Windows.Shapes.Path { Data = Geometry.Parse(paths.GetValueOrDefault(name, paths["explore"])), Width = size, Height = size, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Stretch = Stretch.Uniform, StrokeThickness = 1.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round, Stroke = brush ?? Brush("#91A69C") }; return icon;
    }
}
