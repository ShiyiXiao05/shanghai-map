using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace Modu.Desktop;
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (Updater.Apply(e.Args)) { Shutdown(); return; }
        DispatcherUnhandledException += (_, args) =>
        {
            try { var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ModuExplore"); Directory.CreateDirectory(directory); File.AppendAllText(Path.Combine(directory, "errors.log"), $"{DateTimeOffset.Now:o} {args.Exception}\n"); } catch { }
            MessageBox.Show("操作未完成，请重试。\n" + args.Exception.Message, "魔都·Explore", MessageBoxButton.OK, MessageBoxImage.Warning); args.Handled = true;
        };
        MainWindow = new MainWindow(e.Args); MainWindow.Show();
    }
}
