# @dsh-external/dsh-plugin-updater

DSH 插件更新检查：设置页一键检查/更新所有插件

由 dsh-super-injector dev_scaffold_plugin 生成。

## 实现

- 检查更新：直接依赖并发请求 `<registry>/<pkg>/latest`（registry 依次读 profile / `.dsh` / 用户 `.npmrc`，缺省官方源）+ 本地 `node_modules` 实际版本 semver 比对；不再跑 `pnpm outdated`（已装插件多时检查要数十秒）。
- 结果进程内缓存 10 分钟；`GET /status?force=1` 或「重新检查」按钮强制刷新。
- 更新：`dsh plugin add <pkg>@<latest>` 逐个执行；link 本地包跳过（手动更新）。

## 构建与注入

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
# 注入器环境内：dev_inject_plugin <本目录>
```
