# 地缘行者（Earthborne Rangers）中文卡牌组牌站

非官方粉丝制作的《地缘行者》中文卡牌浏览器与组牌器，参考 [RangersDB](https://www.rangersdb.com) 风格，数据同步自上游实时 API，勘误同步自 [Earthborne Games 官方勘误页](https://thelivingvalley.earthbornegames.com/docs/updates/card_errata/)。

## 功能

- **卡牌浏览**：280 张玩家卡，中文译名 + 本地卡图，按扩展/类型/属性/关键词筛选
- **组牌器**：背景 + 专长构成选择、卡池校验（30 张上限、单卡限量的自动检查）、`EBR1` 分享码导出/导入
- **勘误页**：同步官方 16 条卡牌勘误，已挂载卡牌的勘误在卡牌详情中红框标注
- **翻译状态角标**：人工精修（无标）/ 机翻 / 待翻译，可在卡牌页勾选「仅看未精翻」逐张攻关

## 本地运行

纯静态站点，无构建依赖：

```
python -m http.server 8931
# 访问 http://127.0.0.1:8931
```

或直接双击 `index.html`（file:// 协议下部分浏览器需允许本地 JSON 读取，建议起本地服务）。

## 数据更新与翻译

- `data/cards.zh.json`：全部卡牌数据（含中文译名与翻译状态）
- `data/translations_human.json`：人工精修层，格式 `{"卡牌id": {"text_zh": "精修效果文本"}}`，修改后重新生成数据即自动覆盖机翻
- 卡图加载失败时自动回退上游 CDN（`static.rangersdb.com`）

## 版权声明

本项目为非官方粉丝工具，卡牌文本与图片版权归原作者 Earthborne Games 所有，详见 [COPYRIGHT.md](COPYRIGHT.md)。
