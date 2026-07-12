# Video Remix

视频混剪工具，支持视频上传、智能分段、AI 视频生成和人脸马赛克处理。

## 功能

- **视频上传与分析** — 上传参考视频，自动分析时长、分辨率和帧率
- **智能分段** — 基于场景检测自动分割视频片段，每段不超过 15 秒
- **像素检测** — 自动检测并调整视频分辨率至 Seedance 兼容范围（640×640 ~ 834×1112）
- **人脸马赛克** — 基于 face-api 的人脸检测 + FFmpeg boxblur 自动打码
- **AI 视频生成** — 通过代理转发到 ApiMart / 火山方舟 Seedance 2.0，支持参考视频/参考图/参考音频
- **无限画布** — 集成 Infinite Canvas，导入分段后在画布中自由编排和生成
- **多供应商路由** — 根据 API Key 自动匹配供应商（ApiMart / 字节豆包），互不干扰

## 快速开始

```bash
# 安装依赖
npm install

# 初始化画布子模块（可选）
cd infinite-canvas/web && bun install && cd ../..

# 启动（后端 + 前端 + 画布）
npm run dev:all
```

启动后访问：
- 前端页面：`http://localhost:3001`
- 无限画布：`http://localhost:3000`

## 目录结构

```
src/
├── app.ts                 # Express 入口
├── pipeline/              # 视频处理管道
│   ├── processor.ts       # 管道编排器
│   ├── types.ts           # Step 接口定义
│   └── steps/
│       ├── resolution.ts  # 像素检测/缩放
│       └── faceblur.ts    # 人脸马赛克
├── routes/
│   ├── ai/index.ts        # AI 代理（URL 替换、格式转换、供应商路由）
│   ├── video/             # 视频上传、分析、分段
│   ├── import/            # 导入画布绑定
│   └── ...
└── utils/
    ├── supplier.ts        # 供应商管理
    └── db.ts              # SQLite 数据库
frontend/                  # Vue 3 前端
infinite-canvas/           # Infinite Canvas（子模块）
```

## 供应商配置

在设置页配置多个 AI 供应商，代理根据请求的 API Key 自动路由：

| 供应商 | API 地址 | 用途 |
|---|---|---|
| ApiMart | `https://api.aishuch.com/v1` | 文生图、图生图、Seedance 视频 |
| 字节豆包 | `https://ark.cn-beijing.volces.com/api/v3` | Seedance 视频（直连火山方舟） |

## 技术栈

- **后端**: Node.js + Express + TypeScript
- **前端**: Vue 3 + TDesign
- **画布**: React + Infinite Canvas
- **数据库**: SQL.js (SQLite WASM)
- **视频处理**: FFmpeg + @vladmandic/face-api + TensorFlow.js
- **隧道**: Cloudflared
