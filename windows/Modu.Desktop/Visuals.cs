using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace Modu.Desktop;
public partial class MainWindow
{
    private FrameworkElement BuildMapWelcome()
    {
        var canvas = new Canvas { Width = 340, Height = 230, ClipToBounds = true };
        canvas.Children.Add(new Ellipse { Width = 230, Height = 230, Fill = Ui.Brush("#DFEAE1"), Margin = new Thickness(55, 0, 0, 0) });
        foreach (var data in new[] { "M0,90 C90,150 180,30 340,135", "M80,0 C155,65 130,180 250,230", "M0,200 C100,170 225,170 340,30" }) canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse(data), Stroke = Brushes.White, StrokeThickness = 14 });
        var route = new System.Windows.Shapes.Path { Data = Geometry.Parse("M105,160 C125,140 135,80 208,90"), Stroke = Ui.Brush("#C98873"), StrokeThickness = 2, StrokeDashArray = new DoubleCollection { 3, 4 } }; canvas.Children.Add(route);
        foreach (var (x, y, icon, fill) in new[] { (84.0, 140.0, "pin", "#C98873"), (190.0, 64.0, "explore", "#294E45") })
        {
            var mark = new Border { Width = 52, Height = 52, Background = Ui.Brush(fill), CornerRadius = new CornerRadius(18), Child = Ui.Icon(icon, 24, Brushes.White) }; Canvas.SetLeft(mark, x); Canvas.SetTop(mark, y); canvas.Children.Add(mark);
        }
        var drawing = new Viewbox { Child = canvas, MaxWidth = 340, MaxHeight = 230, Stretch = Stretch.Uniform, VerticalAlignment = VerticalAlignment.Center };
        var title = Ui.Text("下一站，由心动决定。", 24, weight: FontWeights.SemiBold); title.TextAlignment = TextAlignment.Center;
        var note = Ui.Muted("开启地图，在熟悉的城市发现新的喜欢。\n地点收藏与管理也可以独立使用。", 12); note.TextAlignment = TextAlignment.Center;
        var button = Ui.Action("explore", "开启地图服务", () => _ = ConsentMap(), true); button.HorizontalAlignment = HorizontalAlignment.Center;
        var label = Ui.Eyebrow("地图服务尚未开启 · 城市插画"); label.HorizontalAlignment = HorizontalAlignment.Center;
        var panel = Ui.Column(Ui.Space(18), title, Ui.Space(12), note, Ui.Space(20), button, Ui.Space(14), label);
        var layout = new Grid { Margin = new Thickness(24) }; layout.RowDefinitions.Add(new()); layout.RowDefinitions.Add(new() { Height = GridLength.Auto }); layout.Children.Add(drawing); Grid.SetRow(panel, 1); layout.Children.Add(panel); return layout;
    }
}
