"""Produce a portable, offline HTML file and a small source archive. No dependencies."""
from pathlib import Path
import base64
import re
import zipfile

ROOT = Path(__file__).resolve().parent

def write_utf8(path, content):
    # Keep the published HTML identical on Windows and Linux CI.
    with path.open('w', encoding='utf-8', newline='\n') as output:
        output.write(content)

def data_url(path, mime):
    return 'data:' + mime + ';base64,' + base64.b64encode((ROOT / path).read_bytes()).decode()

def build():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    def css_inline(match):
        css = (ROOT / match.group(1)).read_text(encoding='utf-8')
        if match.group(1) == 'game.css':
            for filename in ['epilogue-latin.woff2', 'jetbrains-latin.woff2']:
                css = css.replace('fonts/' + filename, data_url('fonts/' + filename, 'font/woff2'))
            if (ROOT / 'world-poster.jpg').exists():
                css = css.replace('world-poster.jpg', data_url('world-poster.jpg', 'image/jpeg'))
        return '<style>\n' + css + '\n</style>'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_inline, html)
    if (ROOT / 'world-poster.jpg').exists():
        html = html.replace('src="world-poster.jpg"', 'src="' + data_url('world-poster.jpg', 'image/jpeg') + '"')
    html = html.replace('href="favicon.svg"', 'href="' + data_url('favicon.svg', 'image/svg+xml') + '"')
    for filename in ['game-core.js', 'game.js']:
        source = (ROOT / filename).read_text(encoding='utf-8').replace('</script', '<\\/script')
        html = html.replace('<script src="' + filename + '"></script>', '<script>\n' + source + '\n</script>')
    motion = (ROOT / 'assets/motion/motion.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = html.replace('<script type="module" src="assets/motion/motion.js"></script>', '<script type="module">\n' + motion + '\n</script>')
    html = html.replace('<script type="module" src="assets/moments/moments.js"></script>', '')
    lib = data_url('assets/moments/lib.js', 'text/javascript')
    counter = data_url('assets/moments/counter-rolls/moment.js', 'text/javascript')
    counter_css = (ROOT / 'assets/moments/counter-rolls/moment.css').read_text(encoding='utf-8')
    adapter = '''<style>''' + counter_css + '''</style><script type="module">
import counter from "''' + counter + '''";
import * as lib from "''' + lib + '''";
let active;
const attach=()=>{active?.destroy?.();const el=document.getElementById('result-stats');active=counter(el,{}, {...lib,reduced:lib.still});el.dataset.momentMounted='1';};
window.addEventListener('dustvector-results',attach);
document.documentElement.dataset.momentsReady='1';
</script>'''
    html = html.replace('<script type="module" src="game-moments.js"></script>', adapter)
    if (ROOT / 'share.jpg').exists():
        html = html.replace('content="share.jpg"', 'content="' + data_url('share.jpg', 'image/jpeg') + '"')
    write_utf8(ROOT / 'dustvector.html', html)
    # GitHub Pages serves this small, self-contained site. Source and local files
    # stay outside the deployment artifact.
    site = ROOT / 'dist'
    site.mkdir(exist_ok=True)
    write_utf8(site / 'index.html', html)
    (site / '.nojekyll').write_text('', encoding='utf-8')
    files = ['index.html', 'game.css', 'game-core.js', 'game.js', 'game-moments.js', 'favicon.svg',
             'serve.cjs', 'package.json', 'build.py', 'README.md', 'VERIFICATION.md', 'PLAN.md', 'names.json', 'dustvector.html',
             'assets/system.css', 'assets/motion/motion.css', 'assets/motion/motion.js',
             'assets/moments/moments.js', 'assets/moments/lib.js',
             'assets/moments/counter-rolls/moment.js', 'assets/moments/counter-rolls/moment.css']
    files += [str(p.relative_to(ROOT)) for p in (ROOT / 'fonts').glob('*')]
    if (ROOT / 'share.jpg').exists(): files.append('share.jpg')
    if (ROOT / 'world-poster.jpg').exists(): files.append('world-poster.jpg')
    with zipfile.ZipFile(ROOT / 'dustvector-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for filename in files:
            if (ROOT / filename).exists(): archive.write(ROOT / filename, filename)
        for path in (ROOT / 'tests').glob('*.cjs'): archive.write(path, path.relative_to(ROOT))
    print('Built dustvector.html:', (ROOT / 'dustvector.html').stat().st_size, 'bytes')
    print('Built dist/index.html:', (site / 'index.html').stat().st_size, 'bytes')
    print('Built dustvector-source.zip:', (ROOT / 'dustvector-source.zip').stat().st_size, 'bytes')

if __name__ == '__main__': build()
