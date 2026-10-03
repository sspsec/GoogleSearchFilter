/**
 * Bing 搜索结果过滤器 (Surge Script)
 * 改编自 Jason Ng 阿禅 的 GoogleSearchFilter
 * https://github.com/jason5ng32/GoogleSearchFilter
 * 维护: sspsec
 * https://github.com/sspsec/GoogleSearchFilter
 *
 * argument 格式:
 *   websites=域名1,域名2/路径  (逗号分隔, 支持路径, 不支持正则)
 *   combine=true              是否合并内置名单
 *   toggle=false              是否显示被隐藏数量 + 显示/隐藏开关
 */
(function () {
  // ---------- 解析 argument ----------
  function getArg(name, def) {
    var m = ($argument || '').match(new RegExp('(?:^|[?&])' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : def;
  }

  var customSites = (getArg('websites', '') || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var combine = getArg('combine', 'true') === 'true';
  var toggle  = getArg('toggle', 'false') === 'true';

  var builtinSites = [
    // CSDN 系
    'blog.csdn.net',
    'download.csdn.net',
    'wenku.csdn.net',
    'gitcode.com',
    'gitcode.net',
    'gitcode.host',
    // 百度内容农场
    'zhidao.baidu.com',
    'jingyan.baidu.com',
    'wenku.baidu.com',
    'baijiahao.baidu.com',
    'mbd.baidu.com',
    // CSDN/博客镜像搬运站
    'codeleading.com',
    'codenong.com',
    'pianshen.com',
    'itbaoku.cn',
    'jb51.net',
    'html.cn',
    'php.cn',
    // 云厂商 SEO 农场
    'developer.aliyun.com',
    'cloud.tencent.com/developer',
    'developer.huaweicloud.com',
    'worktile.com',
    'pingcode.com',
    // 其他
    'jianshu.com',
    'fx361.com'
  ];

  var blocklist = combine ? builtinSites.concat(customSites) : customSites;

  // ---------- 工具函数 ----------
  // 解析 "blog.csdn.net/path" → { host, path }
  function parseHostPath(str) {
    str = String(str).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    var m = str.match(/^([a-z0-9.\-]+)(\/.*)?$/i);
    if (!m || m[1].indexOf('.') === -1 || /\s/.test(m[1])) return null;
    return { host: m[1].toLowerCase(), path: m[2] || '/' };
  }

  // 解码 Bing 跳转链接 bing.com/ck/a?...&u=a1aHR0c... (base64url)
  function decodeBingRedirect(href) {
    var m = href.match(/[?&]u=a1([A-Za-z0-9\-_]+)/);
    if (!m || typeof atob !== 'function') return null;
    var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      var s = atob(b64);
      return /^https?:\/\//i.test(s) ? s : null;
    } catch (e) { return null; }
  }

  // 从单个结果块里提取 { host, path }
  function extractUrl(itemHtml) {
    // 1. 优先取第一个 <a href> (完整 URL, 处理 bing.com/ck/a 跳转)
    var hrefM = itemHtml.match(/<a[^>]*href="([^"]+)"/i);
    if (hrefM) {
      var href = hrefM[1].replace(/&amp;/g, '&');
      if (/bing\.com\/ck\/a/i.test(href)) {
        var dec = decodeBingRedirect(href);
        if (dec) href = dec;
      }
      var m2 = href.match(/^https?:\/\/([^\/?#]+)([^?#]*)/i);
      if (m2 && !/\.bing\.com$/i.test(m2[1])) {
        return { host: m2[1].toLowerCase(), path: m2[2] || '/' };
      }
    }
    // 2. 兜底: cite 标签 "https://example.com › path › ..."
    var citeM = itemHtml.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
    if (citeM) {
      var text = citeM[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&rsaquo;|&gt;|›|»/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();
      var first = text.split(/\s+/)[0];
      if (first) {
        var hp = parseHostPath(first);
        if (hp) return hp;
      }
    }
    return null;
  }

  // 命中判断: 域名后缀匹配 + 可选路径前缀匹配
  function isBlocked(hp) {
    return blocklist.some(function (entry) {
      var e = parseHostPath(entry);
      if (!e) return false;
      var hostOk = hp.host === e.host || hp.host.slice(-(e.host.length + 1)) === '.' + e.host;
      if (!hostOk) return false;
      if (e.path !== '/') {
        return hp.path === e.path ||
               hp.path.indexOf(e.path.endsWith('/') ? e.path : e.path + '/') === 0;
      }
      return true;
    });
  }

  // 从 start 之后找到与 <li ...> 配对的 </li> (处理嵌套)
  function findClose(html, from) {
    var re = /<li[\s>]|<\/li[\s>]?/gi;
    re.lastIndex = from;
    var depth = 1, m;
    while ((m = re.exec(html)) !== null) {
      if (m[0].charAt(1) === '/') {
        depth--;
        if (depth === 0) return m.index + m[0].length;
      } else {
        depth++;
      }
    }
    return html.length;
  }

  // ---------- 主流程 ----------
  var body = $response.body || '';
  var itemRe = /<li[^>]*class=(["'])[^"']*\bb_algo\b[^"']*\1[^>]*>/gi;
  var items = [], m;

  while ((m = itemRe.exec(body)) !== null) {
    var end = findClose(body, m.index + m[0].length);
    items.push({ start: m.index, end: end, html: body.slice(m.index, end) });
    itemRe.lastIndex = end;
  }

  var out = '', pos = 0, hidden = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var hp = extractUrl(it.html);
    if (hp && isBlocked(hp)) {
      hidden++;
      out += body.slice(pos, it.start);
      if (toggle) {
        // 保留节点, 打上隐藏标记, 供页面开关切换
        out += it.html.replace(/^<li/i, '<li data-bsf="1"');
      }
      pos = it.end;
    }
  }
  out += body.slice(pos);

  // ---------- 注入开关横幅 ----------
  if (toggle && hidden > 0 && out.indexOf('data-bsf="1"') !== -1) {
    var inject =
      '<style>' +
      '#bsfToggle{display:none!important}' +
      '.bsf-banner{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;background:#0067b8;color:#fff;padding:8px 18px;border-radius:20px;' +
      'font:13px/1.4 -apple-system,system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
      'li[data-bsf]{display:none!important}' +
      'body:has(#bsfToggle:checked) li[data-bsf]{display:list-item!important;outline:2px dashed #ff9800}' +
      '</style>' +
      '<input type="checkbox" id="bsfToggle">' +
      '<label class="bsf-banner" for="bsfToggle">已隐藏 ' + hidden + ' 条结果，点击显示 / 隐藏</label>';

    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, inject + '</body>');
    } else {
      out += inject;
    }
  }

  $done({ body: out });
})();
