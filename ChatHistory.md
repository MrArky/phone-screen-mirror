# 开发对话历史 / 续开发交接

> 用途:在新对话窗口继续开发时,先读这份文件即可快速恢复上下文。
> 项目路径:`D:\companyAbout\ITAbout\project\phone-screen-mirror`(Windows,Git Bash / PowerShell)

## 项目是什么
iPhone AirPlay 屏幕镜像**接收端**(自用)。iPhone 通过「控制中心 → 屏幕镜像」投屏到 PC,本程序接收、解密并实时显示。技术栈:**Electron(GUI)+ Node(AirPlay 协议实现,纯 JS,无 C++)**。

## 里程碑进度
- **M0 发现**:mDNS 广播 `_airplay._tcp` / `_raop._tcp`,iPhone 能发现设备。✅
- **M1 握手**:配对 + FairPlay 移植(playfair 与参考 C 实现逐字节一致)。✅
- **M2 解密**:✅ **已解决**。根因是 `bplist-parser@0.3.2` 把 8 字节整数截断成低 32 位,导致 `streamConnectionID`(流密钥哈希输入)出错、解密全乱。修复:`session.js` 里 `recoverU64()` 从原始 plist 字节恢复完整 uint64。另修了设备不发 SETUP② 的问题(补 `raopNtp.js` NTP timing;iPhone replayd 卡死时**重启 iPhone**)。之前"iOS 26 改协议"的判断是被截断 bug 误导,已证伪。
- **M3 渲染**:✅ **本次会话完成并真机验证**(iOS 18.7.8)。解密后的 Annex-B H.264 → WebCodecs 解码 → canvas 实时显示,画面跟随 iPhone 实时变化。

## 本次会话做了什么

### 1. M3 渲染管线(核心)
数据流:`session.js` → `mirrorStream.js` emit `'video'` `{data:Annex-B Buffer, keyframe, kind:'config'|'frame'}` → `server.js` 转成 receiver 事件 → **`main.js` 经 IPC 转发到渲染进程** → **`renderer.js` 用 WebCodecs 解码画到 canvas**。
- `src/main/main.js`:`buildReceiver()` 转发 `video`/`stream-start`/`stream-stop` 到渲染进程(Node Buffer 到渲染端自动变 Uint8Array)。
- `src/preload/preload.js`:`mirror` 桥暴露 `onVideo`/`onStreamStart`/`onStreamStop`/`fit`。
- `src/renderer/renderer.js`:**WebCodecs 解码控制器**。从 `kind:'config'` 的 SPS 推导 `avc1.<profile><constraints><level>` codec 串 → 配置 `VideoDecoder`(**Annex-B 模式,不传 description**,`optimizeForLatency`);关键帧前拼 SPS/PPS 保证 IDR 自足;delta 帧必须等首个关键帧后才喂;队列积压(`decodeQueueSize>10`)丢 delta 防延迟;解出 VideoFrame 画到 `#screen`,尺寸变化时 resize;错误时重建解码器。合成时间戳 `tsCounter++ * 33333`(~30fps,iOS 不给 PTS)。
- `src/renderer/index.html` + `styles.css`:canvas 显示/尺寸。
- Electron 31 = Chromium 126,WebCodecs 原生支持含 Annex-B,无需 muxing 库。

### 2. 环境问题(两个坑,都记进 memory 了)
- **Electron 包损坏**(只剩 `dist/`,包装 JS 没了 → `Cannot find module 'electron'`)。`npm i` 不认(锁文件以为装好)。**修复:`rm -rf node_modules/electron && npm install electron@^31`**(这次没撞 Defender 文件锁,干净成功,v31.7.7)。
- **`ELECTRON_RUN_AS_NODE=1` 全局设置**:让 electron.exe 当普通 Node 跑、不注入 API,`ipcMain`/`app` 全 undefined → `npm start` 崩。**不是代码 bug**。运行时必须清掉这个变量(见下方运行命令)。

### 3. UI 改进(本次会话后半段)
- **连接后隐藏"Waiting…"提示**:根因是 `.placeholder{display:flex}` 优先级高于 UA 的 `[hidden]{display:none}`,导致 `hidden` 属性失效。修复:全局加 `[hidden]{display:none !important}`。另外真实帧画出来时也强制隐藏提示(双保险)。
- **演示模式**:右上角「演示模式」按钮 → 隐藏顶栏+侧边日志栏,画面纯黑铺满;右上角浮现「按 Esc 退出」提示 3 秒后淡出;**Esc 退出**。
- **窗口按手机比例自动收缩**:视频尺寸已知时渲染进程把 `{vw,vh,extraW(侧栏宽),extraH(顶栏高)}` 发给主进程,`fitWindow()` 用 `setContentSize` 缩窗 + `setAspectRatio` 锁比例;演示模式下 chrome 尺寸为 0 → 窗口精确等于视频比例、零留白;断流恢复默认 1100×760。
- **去掉菜单栏**:`Menu.setApplicationMenu(null)`。
- **去掉滚动条**:flex 纵向布局替代写死的 `calc(100%-55px)`,`html,body{overflow:hidden}`。

> ⚠️ 遗留待确认:窗口在视频开始时会自动调整大小(可能跳一下)。用户如果觉得突兀,可改成"仅首帧适配一次、之后不动"或"固定窗口+画面居中"。

## 如何运行 / 验证
- **GUI(带界面,真机投屏用)**:PowerShell → `Remove-Item Env:ELECTRON_RUN_AS_NODE -EA 0; npm start`;Bash → `env -u ELECTRON_RUN_AS_NODE npm start`。
- **无 GUI 接收端测试**:`npm run mdns:test`(纯 Node,改代码后重启;端口占用就 taskkill 掉 7000 的 PID)。
- **离线解密验证(不用点手机)**:`node test/playfair-offline.js`(读 `data/debug-capture.json`,现存的是能正确解密的 iOS 18 抓包)。
- **真机不发 SETUP²/无画面** → 先**重启 iPhone**(replayd 卡死)。

## 后续功能待办
见 `ROADMAP.md`:①旋转/分辨率变化处理 ②延迟/流畅度调优 ③音频(stream type 96,现忽略)④UI 完善(全屏、比例锁定、状态信息、重连提示)⑤技术债:替换 bplist-parser 去掉 `recoverU64` workaround。

## 关键文件速查
- 协议实现:`src/main/airplay/`(`server.js` 编排、`session.js` 会话/SETUP、`mirrorStream.js` 视频流解析+发帧、`mirrorCrypto.js` AES-CTR、`playfair.js`/`fairplay.js` FairPlay、`pairing.js` 配对、`raopNtp.js` NTP、`plist.js`、`mdns.js`、`httpServer.js`)。
- Electron:`src/main/main.js`(主进程/窗口/IPC)、`src/preload/preload.js`(桥)、`src/renderer/`(`renderer.js` 解码+UI、`index.html`、`styles.css`)。
- 参考:`reference/`(编译好的 C 参考实现,如 `fairplay_ref.exe`,用于逐字节比对)。
