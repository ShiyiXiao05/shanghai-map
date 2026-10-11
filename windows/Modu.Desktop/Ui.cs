using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace Modu.Desktop;
internal static class Ui
{
    public static Brush Brush(string color) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
    public static void Resource(FrameworkElement target, DependencyProperty property, string name) => target.SetResourceReference(property, name);
    public static TextBlock Text(string text, double size = 13, string? color = null, FontWeight? weight = null)
    {
        var block = new TextBlock { Text = text, FontSize = size, FontWeight = weight ?? FontWeights.Normal, LineHeight = size * 1.6, TextWrapping = TextWrapping.Wrap };
        if (color != null) block.Foreground = Brush(color); return block;
    }
    public static TextBlock Muted(string text, double size = 12) { var b = Text(text, size); Resource(b, TextBlock.ForegroundProperty, "Muted"); return b; }
    public static Button Button(string text, Action action, bool primary = false, string? hint = null)
    {
        var b = new Button { Style = (Style)Application.Current.FindResource(primary ? "Primary" : typeof(Button)), ToolTip = hint ?? text };
        var label = new TextBlock { Text = text }; label.SetBinding(TextBlock.ForegroundProperty, new System.Windows.Data.Binding("Foreground") { Source = b }); b.Content = label;
        AutomationProperties.SetName(b, hint ?? text); b.Click += (_, _) => action(); return b;
    }
    public static Button Quiet(string text, Action action, string? hint = null) { var b = Button(text, action, hint: hint); b.Style = (Style)Application.Current.FindResource("Quiet"); return b; }
    public static TextBox Input(string name, string value = "", int max = 0, bool multi = false)
    {
        var box = new TextBox { Text = value, ToolTip = name, Tag = name, MaxLength = max, AcceptsReturn = multi, TextWrapping = multi ? TextWrapping.Wrap : TextWrapping.NoWrap, MinHeight = multi ? 100 : 42 };
        AutomationProperties.SetName(box, name); return box;
    }
    public static StackPanel Column(params UIElement[] elements) { var p = new StackPanel(); foreach (var e in elements) p.Children.Add(e); return p; }
    public static StackPanel Row(params UIElement[] elements) { var p = new StackPanel { Orientation = Orientation.Horizontal }; foreach (var e in elements) { if (e is FrameworkElement f) f.Margin = new Thickness(0, 0, 8, 0); p.Children.Add(e); } return p; }
    public static WrapPanel Wrap(params UIElement[] elements) { var p = new WrapPanel(); foreach (var e in elements) { if (e is FrameworkElement f) f.Margin = new Thickness(0, 0, 8, 8); p.Children.Add(e); } return p; }
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
    public static System.Windows.Shapes.Path Icon(string name, double size = 18, Brush? brush = null)
    {
        var paths = new Dictionary<string, string>
        {
            ["explore"] = "M12,2 L20,6 L20,18 L12,22 L4,18 L4,6 Z M12,2 L12,22 M4,6 L20,18 M20,6 L4,18",
            ["route"] = "M5,5 A3,3 0 1 0 5,5.1 M19,19 A3,3 0 1 0 19,19.1 M5,8 L5,14 Q5,18 11,12 Q19,5 19,16",
            ["memory"] = "M3,7 L21,7 L21,20 L3,20 Z M8,7 L9,4 L15,4 L16,7 M16,13 A4,4 0 1 0 16,13.1",
            ["maps"] = "M2,5 L8,3 L16,6 L22,3 L22,20 L16,22 L8,19 L2,22 Z M8,3 L8,19 M16,6 L16,22",
            ["trash"] = "M4,6 L20,6 M9,6 L9,3 L15,3 L15,6 M6,6 L7,21 L17,21 L18,6 M10,10 L10,17 M14,10 L14,17",
            ["settings"] = "M12,8 A4,4 0 1 0 12,16 A4,4 0 1 0 12,8 M12,2 L12,5 M12,19 L12,22 M2,12 L5,12 M19,12 L22,12 M5,5 L7,7 M17,17 L19,19 M19,5 L17,7 M7,17 L5,19",
            ["poster"] = "M4,3 L20,3 L20,21 L4,21 Z M7,16 L11,12 L14,15 L17,10 M8,8 A1,1 0 1 0 8,8.1",
            ["history"] = "M3,10 A9,9 0 1 1 3,16 M3,3 L3,10 L9,10 M12,7 L12,13 L16,15",
        };
        var icon = new System.Windows.Shapes.Path { Data = Geometry.Parse(paths.GetValueOrDefault(name, paths["explore"])), Width = size, Height = size, Stretch = Stretch.Uniform, StrokeThickness = 1.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round, Stroke = brush ?? Brush("#91A69C") }; return icon;
    }
}
