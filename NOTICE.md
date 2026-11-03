# 第三方组件与许可

本礼物页是「二开」（在开源项目基础上修改）作品，包含以下第三方代码。原始开源代码均完整保留在 `vendor/` 目录，附各自许可证。

## 1. heart-code —— 爱心页（index.html）的上游

- 仓库：https://github.com/realchenchenluo/heart-code
- 作者：realchenchenluo
- 许可：MIT
- 使用部分：`popup.html`（近百个窗口沿心形曲线逐张贴上、心跳、炸开铺满的动效与时间线）
- 保留位置：`vendor/heart-code/popup.html`、`vendor/heart-code/LICENSE`、`vendor/heart-code/README.md`
- 我们的修改（二开）：
  - 主题从「生日祝福」改为一周年纪念，文案全部改为可配置（`js/data.js`）
  - 配色从高饱和荧光色改为视频里的马卡龙浅色系
  - 窗口标题栏从「三个圆点」改为视频里的「♡ / ×」
  - 背景改为粉色渐变 + 手写体「一周年 / Happy Anniversary」
  - 中间主窗口改为两行（中文 + Happy Anniversary）
  - 去掉原项目的 HUD 编辑面板，「炸开铺满」后接入二开入口卡（一起吹蜡烛）
  - 新增向蛋糕页（cake.html）的跳转

## 2. Three.js r128 —— 蛋糕页（cake.html）的 3D 引擎

- 仓库：https://github.com/mrdoob/three.js
- 许可：MIT
- 保留位置：`vendor/three/three.min.js`、`vendor/three/LICENSE`
- 用途：蛋糕页的三维场景、材质、光照、粒子

## 3. 背景音乐 —— 故事页（story.html）的 BGM

- 曲目：**Romantic Piano**
- 作者：**AtlasAudio**
- 来源：Pixabay Music
- 链接：https://pixabay.com/music/solo-piano-romantic-piano-625734/
- 许可：**Pixabay Content License**（免费使用，无需署名；不得把音频单独转售/再分发）
- 保留位置：`assets/music/bgm.mp3`
- 说明：这是可以自由使用的免版权曲目。如果想换成《我是真的爱上你》之类的版权歌曲，只能用于私人自用，公开分享/发布有版权风险。

## 4. 参考素材

- 抖音参考视频：`https://v.douyin.com/W7dOOZZHIlE/`（作者：老婆孩子我对不起你们啊，2026-10-23 发布，31 秒）
- 视频仅作**效果参考**，本项目没有使用视频中的任何画面 / 音频素材。爱心页与蛋糕页均为代码重绘。

## 说明

- `js/data.js`、`js/story.js`、`css/story.css`、`story.html`、`cake.html`、`js/cake.js` 中的原创部分由本项目作者编写。
- 若要公开发布本礼物页，请保留 `vendor/` 下的 LICENSE 与本 NOTICE。
