# 双模式卫星实时地图

## 结论

中央地图提供两个相互隔离的显示模式：

1. **可复现实况模拟**：默认模式，离线可运行；船位来自固定随机种子与公开数据校准状态机。
2. **卫星实时定位**：真实卫星纹理、DEM 三维地貌与后端授权 AISStream 船位相互独立叠加。

未配置 MapTiler 时，第二种模式加载 EOX Sentinel-2 cloudless 2025 合成影像作为真实卫星纹理，
使用 Mapterhorn DEM 生成三维地形，并保留 OpenFreeMap 地名道路。该影像是 2025 年多景合成层，
不是实时拍摄；界面会明确显示这一时间边界。默认采用真彩色、无雾化显示，高程仅作 1.5 倍视觉
增强，避免灰暗滤镜或大气雾遮挡海岸线和地貌。配置 MapTiler 后自动替换为 MapTiler Satellite
高分瓦片。两种情况都不会改变 AIS 的真实性门禁。

EOX 公共影像用于本项目的本地、非商业演示并保留在线署名；商业部署或再分发前必须配置具有相应
许可的 MapTiler/自有影像源，或另行取得 EOX 商业授权。

卫星影像和船位是两个不同来源。影像拍摄时间不等于 AIS 报文时间；本功能不是 ECDIS、VTS、
航海通告或生产调度系统。

## 安全配置

复制示例文件，不要把真实密钥提交到 Git：

```bash
cp .env.example .env
```

在 `.env` 中设置：

```dotenv
MAPTILER_API_KEY=<限制部署域名的 MapTiler 浏览器密钥>
AISSTREAM_API_KEY=<仅服务端持有的 AISStream 密钥>
AISSTREAM_WEBSOCKET_URL=wss://stream.aisstream.io/v0/stream
```

- MapTiler 密钥最终会随瓦片 URL 被浏览器使用，应在 MapTiler Cloud 中限制允许的部署来源和额度。
- AISStream 密钥只存在于后端进程；`/api/geospatial/live` 永不返回该密钥。
- AISStream 官方不支持浏览器直接跨域订阅，本项目严格采用后端单连接、前端轮询本地快照的模式。
- 当前订阅范围固定为马六甲区域 `0.35–6.25°N, 99–105°E`。

## 真实性门禁

界面只有同时满足以下条件才显示“卫星影像 + 授权实时 AIS 已验证”：

- MapTiler 卫星瓦片配置存在且浏览器完成加载；
- AISStream WebSocket 已连接；
- 至少有一个船位在后端接收时间的五分钟新鲜度窗口内；
- 经纬度落在马六甲订阅边界内；
- MMSI 和定位报文可解析。

任一条件不满足时，卫星实时模式严格失败关闭：显示原因和零个真实船位，不将模拟船位、历史回放
或缓存旧船位显示为实时目标。三维卫星地貌仍可独立浏览，但“影像合成时间”和“实时 AIS 状态”会
分开标识；模拟地图仍可独立使用。

## 接口验收

```bash
curl -fsS http://127.0.0.1:5174/api/geospatial/live
```

重点检查：

```text
protocolVersion=geospatial-live-map.v1
satellite.configured=true
ais.connectionState=connected
ais.liveDataVerified=true
ais.freshVesselCount>0
authority.satellite_realtime_ready=true
authority.navigation_authority=false
authority.production_authority=false
```

浏览器中点击中央地图上方“卫星实时定位”，核对卫星瓦片署名、AIS 状态、真实船位数、最新报文时间、
接收延迟以及底部非导航/非生产授权声明。点击船舶可检查 MMSI、经纬度、SOG、航向、AIS 时间和
定位精度标记。

## 生产边界

AISStream 官方当前为 Beta 且不提供可用性 SLA，适合作为开源演示与实时接入验证，不应成为港口
生产 VTS 的唯一数据源。现场落地仍需港口授权 AIS/VTS 服务、独立新鲜度监控、覆盖率统计、消息
去重、身份权限、持久化审计、影子运行和运营方验收。

## 资料

- AISStream API：<https://aisstream.io/documentation.html>
- MapTiler Tiles API：<https://docs.maptiler.com/cloud/api/tiles/>
- MapTiler attribution：<https://docs.maptiler.com/guides/map-design/attribution/add-attribution/>
- OpenFreeMap quick start：<https://openfreemap.org/quick_start/>
- MapLibre 3D terrain：<https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/>
- MapLibre hybrid satellite terrain：<https://maplibre.org/maplibre-gl-js/docs/examples/display-a-hybrid-satellite-map-with-terrain-elevation/>
- EOX Sentinel-2 cloudless 2025：<https://cloudless.eox.at/>
- Mapterhorn terrain attribution：<https://mapterhorn.com/attribution/>
