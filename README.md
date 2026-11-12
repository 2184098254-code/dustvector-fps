# DUSTVECTOR 尘线 · 海底泡泡大作战

可离线运行的 HTML 第一人称泡泡小游戏。明亮的海底小镇、圆润水母、珊瑚与泡泡发射器，完成三波小镇守护挑战。

在线游玩：[GitHub Pages](https://2184098254-code.github.io/dustvector-fps/)

备用入口：[Vercel](https://dustvector-fps.vercel.app)

## 直接开始

双击 `dustvector.html`，用 Chrome 或 Edge 打开，点击「开始行动」。这个单文件已包含游戏代码、样式、字体和交互动效，无需安装依赖，也不请求外网。

开发版本也可以运行：

```powershell
npm start
```

然后访问 `http://127.0.0.1:5173`。分文件版 `index.html` 建议通过本地服务打开；单文件 `dustvector.html` 可直接双击。

## 操作

| 操作 | 键位 |
| --- | --- |
| 前后左右移动 | W / A / S / D |
| 环视与瞄准 | 鼠标移动，或方向键 |
| 连续发射泡泡 | 按住鼠标左键，或空格 |
| 冲刺 | 按住 Shift |
| 补充泡泡 | R |
| 暂停 / 继续 | Esc 或 P |
| 全屏 / 声音 | 顶部右侧按钮 |

开始后浏览器会请求锁定鼠标。若浏览器拒绝，可以按住画面拖动瞄准，也可以用方向键。切换窗口、切换标签或失去鼠标锁定时游戏自动暂停。

手机采用双拇指控制：

- **左侧任意位置按住拖动**：浮动摇杆在手指附近出现；向前推远一点可以快跑。
- **右侧任意空白位置拖动**：转动视角，手指滑出原区域仍持续响应。
- **按住黄色泡泡按钮并拖动**：同时连续发射与瞄准，左手可以继续移动。
- **点击补泡泡按钮**：补充当前泡泡瓶；左手保持移动时也能操作。
- **暂停按钮**：其他手指仍按住时也能暂停，暂停、切换应用和旋转屏幕都会清理输入。
- **操作指南**：可调整转向灵敏度，设置保存在当前浏览器。

横屏拥有更宽的视野，竖屏也可正常玩。界面使用动态视口高度，并为刘海、Safari 工具栏和底部手势区留出空间。

## 任务规则

- 轻松冒险共三波：4、6、8 只水母；水母派对为 5、7、9 只，对手移动与攻击也会增强。
- 水母发射可以躲避的泡泡；小箱、房子和边界参与真实碰撞及遮挡。
- 初始活力 100，当前泡泡瓶容量 24，泡泡储备 120；空瓶自动补充，补充时暂时不能发射。
- 绿色补给恢复活力 35，黄色补给增加泡泡 36。每波结束恢复活力 20、发放泡泡 48，活力不超过 100。
- 三波全部完成后胜利，活力归零则结束。结算显示积分、水母数、命中率和时间。最高分存于当前浏览器本地。

## 文件与实现

- `game-core.js`：独立模拟逻辑、碰撞、射线、敌人、弹丸与波次。
- `touch-input.js`：指针归属、浮动摇杆、多点触控、滑动瞄准与输入清理。
- `game.js`：原生 WebGL 海底场景、水母、泡泡发射器、输入、合成音效、应用状态。
- `game.css`：海底卡通界面、横竖屏与安全区布局。
- `assets/`：用户指定的 design-taste-frontend skill 原始素材，保持不修改。交付压缩包只收录运行所需文件。
- `fonts/`：本地 Epilogue 与 JetBrains Mono 字体，附 OFL 许可证。
- `build.py`：生成单 HTML 和源码压缩包；`npm run build` 可以重新打包。

不使用第三方游戏引擎、在线图片、在线音频或 CDN。需要支持 WebGL 的浏览器。

## GitHub Pages 部署

运行 `python build.py` 会生成可直接双击的 `dustvector.html`，以及用于静态托管的 `dist/index.html`。部署产物只包含游戏，不包含源码、浏览器缓存或本地输出。

仓库已设为公开，使用 GitHub Actions 发布 Pages。`.github/workflows/pages.yml` 在推送到 `main` 后运行机制测试、构建网站，再自动发布 `dist`；同时保留 `dustvector-site` 构建产物。

仓库 Settings → Pages 的 Source 应设置为 GitHub Actions。也可以在 Actions 中手动运行发布工作流。`dist/index.html` 已内嵌运行资源，可以在项目子路径下使用。

## Vercel 公开部署

Vercel 作为备用托管入口，部署只使用 `dist` 目录中的游戏网页。

```powershell
python build.py
npx vercel@65.14.0 login
npx vercel@65.14.0 deploy dist --prod --project dustvector-fps --create-if-missing --yes
```

首次运行需要在浏览器中完成 Vercel 授权。部署完成后，CLI 会返回网站的生产地址。后续更新先重新构建，再运行同一条 deploy 命令；推送到 GitHub 会自动更新 Pages，当前工作流没有配置 Vercel 自动发布。

## 素材与字体

游戏场景、模型与音效由项目代码生成。Epilogue 和 JetBrains Mono 字体以 SIL Open Font License 分发，各自许可文件保存在 `fonts/` 中。`assets/` 内只收录本项目实际使用的原始设计运行时。

## 验证

```powershell
npm test
```

机制测试覆盖射线、遮挡、防穿墙、斜向移动速度、补充及暂停、三波胜利、失败、弹丸与补给。触控回归测试覆盖浮动起手、跨区域拖动、多指同时移动和发射、取消与捕获丢失、暂停清理、死区和快跑。

安装有 Chrome 或 Chromium 的环境可运行 `npm run test:browser`，用实际多点触摸事件检查五种横竖屏尺寸、双手同时操作、手指释放、暂停、旋转屏幕与模拟安全区。该检查使用桌面 Chromium 的移动模拟，不能替代实体 iPhone Safari 的真机验证。
