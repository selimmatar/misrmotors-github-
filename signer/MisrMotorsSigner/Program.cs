using System.Drawing;
using Microsoft.Win32;

namespace MisrMotorsSigner;

static class Program
{
    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, "MisrMotorsSigner-" + Environment.UserName, out var first);
        if (!first) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext());
    }
}

sealed class TrayContext : ApplicationContext
{
    readonly NotifyIcon _icon = new() { Visible = true };
    readonly ConfigStore _store = new(ConfigStore.DefaultPath(), new DpapiProtector());
    readonly TokenSession _session = new();
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 10_000 };
    readonly string _logPath = Path.Combine(Path.GetDirectoryName(ConfigStore.DefaultPath())!, "signer.log");
    readonly ToolStripMenuItem _status = new("Starting...") { Enabled = false };
    HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    SignerLoop? _loop;
    int _ticks;
    bool _busy;

    public TrayContext()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add(_status);
        menu.Items.Add("Enter PIN / sign now", null, async (_, _) => await Run(l => l.SignNowAsync(CancellationToken.None)));
        menu.Items.Add("Connect to ERP (paste key)...", null, (_, _) => Pair());
        var auto = new ToolStripMenuItem("Start with Windows") { Checked = IsAutoStart() };
        auto.Click += (_, _) => { SetAutoStart(!auto.Checked); auto.Checked = IsAutoStart(); };
        menu.Items.Add(auto);
        menu.Items.Add("Open log", null, (_, _) => { if (File.Exists(_logPath)) System.Diagnostics.Process.Start("notepad.exe", _logPath); });
        menu.Items.Add("Exit", null, (_, _) => { _icon.Visible = false; Application.Exit(); });
        _icon.ContextMenuStrip = menu;
        _icon.DoubleClick += async (_, _) => await Run(l => l.SignNowAsync(CancellationToken.None));
        Show(new SignerState(Health.NotPaired, 0, "Not connected"));

        if (_store.Load() is null) Pair(); else Start();
        _timer.Tick += async (_, _) =>
        {
            _ticks++;
            await Run(async l => { await l.TickAsync(CancellationToken.None); if (_ticks % 6 == 0) await l.PingAsync(CancellationToken.None); });
        };
        _timer.Start();
    }

    void Start()
    {
        var s = _store.Load();
        if (s is null) { Show(new SignerState(Health.NotPaired, 0, "Not connected - choose Connect to ERP")); _loop = null; return; }
        _http.Dispose();
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _loop = new SignerLoop(new SignerApi(_http, s.ServerUrl, s.Key), _session, Show, Log);
        // The PIN is typed once now (the token driver's own prompt); it is never stored.
        _ = Run(l => l.SignNowAsync(CancellationToken.None));
    }

    async Task Run(Func<SignerLoop, Task> work)
    {
        if (_loop is null || _busy) return;
        _busy = true;
        try { await work(_loop); } finally { _busy = false; }
    }

    void Pair()
    {
        using var f = new Form { Text = "Connect to ERP", Width = 460, Height = 210, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
        var cur = _store.Load();
        var url = new TextBox { Left = 12, Top = 30, Width = 420, Text = cur?.ServerUrl ?? "https://" };
        var key = new TextBox { Left = 12, Top = 82, Width = 420, UseSystemPasswordChar = true };
        var ok = new Button { Text = "Connect", Left = 340, Top = 125, Width = 92, DialogResult = DialogResult.OK };
        f.Controls.AddRange(new Control[]
        {
            new Label { Text = "ERP address / عنوان النظام", Left = 12, Top = 10, Width = 420 }, url,
            new Label { Text = "Signer key (from E-invoice settings) / مفتاح التوقيع", Left = 12, Top = 62, Width = 420 }, key, ok,
        });
        f.AcceptButton = ok;
        if (f.ShowDialog() != DialogResult.OK) return;
        try
        {
            _store.Save(new SignerSettings(url.Text, key.Text));
            Start();
        }
        catch (ArgumentException e) { MessageBox.Show(e.Message, "Signer"); }
    }

    void Show(SignerState s)
    {
        void Apply()
        {
            var text = s.Message.Length > 60 ? s.Message[..60] : s.Message;
            _icon.Text = "Misr Motors signer: " + text;
            _status.Text = s.Message;
            var color = s.Health == Health.Ready ? Color.Green : Color.Red;
            using var bmp = new Bitmap(16, 16);
            using (var g = Graphics.FromImage(bmp)) { g.Clear(Color.Transparent); using var b = new SolidBrush(color); g.FillEllipse(b, 1, 1, 14, 14); }
            var old = _icon.Icon;
            _icon.Icon = Icon.FromHandle(bmp.GetHicon());
            old?.Dispose();
        }
        Apply();
    }

    void Log(string line)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
            File.AppendAllText(_logPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}{Environment.NewLine}");
        }
        catch (IOException) { }
    }

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static bool IsAutoStart() { using var k = Registry.CurrentUser.OpenSubKey(RunKey); return k?.GetValue("MisrMotorsSigner") is not null; }
    static void SetAutoStart(bool on)
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey, true);
        if (k is null) return;
        if (on) k.SetValue("MisrMotorsSigner", "\"" + Environment.ProcessPath + "\""); else k.DeleteValue("MisrMotorsSigner", false);
    }
}
