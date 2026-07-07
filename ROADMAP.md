# Roadmap / 功能待办

主线已完成:iPhone 屏幕镜像从发现 → 配对 → FairPlay → 解密 → WebCodecs 解码 → canvas 实时显示,已在真机(iOS 18.7.8)验证通过。以下是后续可做的功能,按优先级排列,供后期参考。

## 1. 旋转 / 分辨率变化处理
- **现状**:横竖屏切换未专门测试。渲染器已能在收到新 SPS 时重配 `VideoDecoder` 并 resize canvas(`src/renderer/renderer.js` 的 `handleConfig` / `onFrameDecoded`),但没在真机上确认横竖屏切换是否无花屏。
- **要做**:实测 iOS 旋转时是否重发 `kind:'config'`;若只在首次发 config,需要另想办法感知分辨率变化(如从 SPS 解析 width/height,或监听帧尺寸)。确保切换瞬间不残留旧帧、不拉伸变形。

## 2. 延迟 / 流畅度调优
- **现状**:用合成的 ~30fps 时间戳(`tsCounter++ * 33333`),背压丢帧阈值固定为 `decodeQueueSize > 10`。
- **要做**:真机测重动态画面(游戏/滑动)下的延迟与卡顿;必要时调整丢帧策略、时间戳推导(可参考包头或到达时间),评估是否启用硬件解码路径。目标是低延迟实时投屏。

## 3. 音频
- **现状**:mirror 流里的 type 96(音频)包目前直接忽略(`src/main/airplay/mirrorStream.js`)。
- **要做**:解析并解密音频流,经 IPC 送到渲染进程用 WebAudio / `AudioDecoder` 播放,并与视频做基本同步。是"完整投屏体验"的下一大块。

## 4. UI 完善
- 全屏模式(区别于已做的"演示模式":演示模式是隐藏周边只留画面,全屏是占满显示器)。
- 画面比例锁定 / 窗口自适应。
- 连接状态、分辨率、帧率等信息展示。
- 断线重连提示。

## 5. 技术债:替换 bplist-parser
- **背景**:`bplist-parser@0.3.2` 会把 8 字节整数截断成低 32 位,曾导致 `streamConnectionID` 出错、解密全乱(见 M2 修复记录)。当前用 `session.js` 的 `recoverU64()` workaround 绕过。
- **要做**:换成不截断 8 字节整数的 plist 解析库(或自己实现该分支),从源头干掉这个 bug,移除 `recoverU64` workaround。

---
*运行提示:PowerShell 下用 `Remove-Item Env:ELECTRON_RUN_AS_NODE -EA 0; npm start`(该环境变量会让 Electron 当普通 Node 跑导致启动崩溃)。*
