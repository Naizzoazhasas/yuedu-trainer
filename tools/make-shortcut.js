/* 用 JScript 创建 Windows 快捷方式（.lnk）
 *
 * 为什么用 cscript + JScript：PowerShell 7 默认没有 WScript.Shell 兼容层，
 * 而 cscript 在所有 Windows 上都可用，并且能正确写 Unicode 名称。
 *
 * 重要实现细节：
 *   1. 本文件会被复制到「纯 ASCII 临时路径」下再执行——因为 cscript 通过命令行
 *      读取含中文的脚本路径时，会受控制台 OEM 代码页影响而找不到文件。
 *   2. 所有中文参数（快捷方式名、描述、工作目录）通过一个 UTF-8 的 JSON 参数文件传入，
 *      同样是为了绕开命令行的编码问题。用 ADODB.Stream 以 UTF-8 读回。
 *
 * 用法：
 *   cscript //nologo <ascii-path>\make-shortcut.js <utf8-json-param-file>
 */
(function () {
  if (typeof WScript === 'undefined') return;

  var args = [];
  for (var i = 0; i < WScript.Arguments.length; i++) args.push(WScript.Arguments(i));
  if (args.length < 1) {
    WScript.Echo('用法: cscript make-shortcut.js <param.json>');
    WScript.Quit(2);
  }

  /* ---- 以 UTF-8 读取 JSON 参数文件 ---- */
  function readUtf8(file) {
    var stream = new ActiveXObject('ADODB.Stream');
    stream.Type = 2;              // adTypeText
    stream.Charset = 'utf-8';
    stream.Open();
    stream.LoadFromFile(file);
    var text = stream.ReadText();
    stream.Close();
    return text;
  }

  var paramText = readUtf8(args[0]);
  var cfg = eval('(' + paramText + ')');

  var shell = new ActiveXObject('WScript.Shell');
  var fso = new ActiveXObject('Scripting.FileSystemObject');
  var made = 0;

  for (var k = 0; k < cfg.shortcuts.length; k++) {
    var s = cfg.shortcuts[k];
    var lnk = shell.CreateShortcut(s.path);
    lnk.TargetPath = s.target;
    if (s.arguments) lnk.Arguments = s.arguments;
    if (s.workdir) lnk.WorkingDirectory = s.workdir;
    if (s.description) lnk.Description = s.description;
    if (s.icon) lnk.IconLocation = s.icon;
    lnk.WindowStyle = 1;
    lnk.Save();
    if (fso.FileExists(s.path)) made++;
  }

  WScript.Echo('created ' + made + '/' + cfg.shortcuts.length);
  WScript.Quit(made === cfg.shortcuts.length ? 0 : 1);
})();
