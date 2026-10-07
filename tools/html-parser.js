/* 从 tools/test-app.js 里取用那个极简 HTML 解析器（供其它诊断脚本复用） */
'use strict';
var fs = require('fs');
var path = require('path');

/** @returns {function(string, Object): void} 把 index.html 的 body 解析进给定 document */
function loadParser() {
  var src = fs.readFileSync(path.join(__dirname, 'test-app.js'), 'utf8');
  var start = src.indexOf('function parseHTML');
  var end = src.indexOf('parseHTML(html);');
  if (start < 0 || end < 0) throw new Error('在 test-app.js 里找不到 parseHTML');
  var body = src.slice(start, end);
  /* test-app.js 里的 parseHTML 依赖外层的 doc 变量，这里把它显式作为参数注入：
   * 先构造工厂，再把 doc 绑进闭包返回真正的解析函数 */
  var inner = new Function('doc', body + '\nreturn parseHTML;');
  return function (html, document0) {
    var d = document0 || (typeof global !== 'undefined' ? global.document : null);
    if (!d) throw new Error('html-parser: 需要传入 document 或先安装 dom-shim');
    return inner(d)(html);
  };
}

module.exports = { loadParser: loadParser };
