# IEC 61850 投运门禁

协议模式只允许来自签名配置中的 `protocol.mode`。当前配置格式为 `schemaVersion 4`；旧版本或缺少该字段的配置会迁移为 `DISABLED`，不能自动启用 Modbus 或 IEC 61850。正式升级必须由批准人员补齐字段并重新签名。

`EMS_PROTOCOL_MODE` 不是启用通道，只允许设为 `DISABLED` 做紧急降级。其他值会报 `UNSIGNED_PROTOCOL_OVERRIDE_FORBIDDEN`。配置缺少模式或明确禁用时会报 `PROTOCOL_DISABLED`，并在创建 WebSocket、租约或协议连接前退出。

IEC 61850 配置目前为 `MISSING_VENDOR_SCL`。只有通道映射、厂商 SCL 文件相对路径及 SHA-256 均明确，且文件真实路径位于受限根目录内，才可进入后续投运验证。新正式包必须携带 schema 4 配置及其新签名；旧签名不能复用。

## 页面预检与协议切换

“通信与点表”页面提供IEC 61850投运预检，逐项显示签名协议模式、协调控制器边界、MMS规范点映射、SCL状态和缺失材料。“参数设置”中的协议模式有且只有：`DISABLED`、`MODBUS_TCP_DEBUG_READ_ONLY`、`IEC61850_PRODUCTION`。

模式修改属于根配置修改，必须经过CONFIG_WRITE双人凭证、Ed25519分离签名并重启生效。每次实际模式变化写入集中审计，记录旧模式、新模式和“需重启”结果。若选择`IEC61850_PRODUCTION`时预检未通过，规范化签名接口和保存接口均返回`IEC61850_PRECHECK_FAILED`，配置不会写入。

Windows EMS禁止直接发布GOOSE；一次调频目标只能委托给专用协调控制器。当前协调控制器未配置，预检固定显示`COORDINATOR_NOT_CONFIGURED`。取得厂家材料后，仍须完成SCL、MMS、GOOSE、双网、对时和FAT/SAT，不能仅凭页面显示READY直接投运。

EMS与协调控制器之间采用传输无关的`PRIMARY_FREQUENCY_ENVELOPE`逻辑契约，而不是把PCC频率采样或每台PCS的毫秒级给定发给Windows。契约固定包含版本、来源、唯一命令号、签发/失效时间、站级有功目标和允许的上下限。发送边界逐项检查当前EMS是否持有主机权限、时间窗、站级绝对功率上限、目标是否位于上下限内及命令号是否重复；协调控制器ACK必须在限定时间内返回、命令号一致且状态为`ACCEPTED`，否则失败关闭并写审计。当前软件默认命令最长有效期5秒、未来时钟容差250毫秒；正式值需按对时方案和一次调频接口设计评审后配置。

这只是软件边界，不代表现场传输已实现。最终可由协调控制器厂家SDK、经认证的MMS控制服务或双方批准的工业协议承载；必须做身份认证、完整性保护、白名单和主备fencing。`CoordinatorBoundary`明确拒绝带`publishGoose`能力的传输对象，Web页面不提供一次调频直接发送按钮，普通Modbus调试服务也不得调用该边界。协调控制器收到有效包后，才在自己的实时任务中读取PCC频率，完成死区/下垂/爬坡/限幅/50台PCS分配并发布GOOSE。

每条MMS映射必须同时给出厂家通道引用、现有EMS设备ID和V1.2规范点名，例如`channel + deviceId + pointName`。预检拒绝没有设备绑定或设备未在EMS启用清单中的映射。厂家协议栈回调进入`Iec61850TelemetryRuntime`后，数据以`IEC61850_MMS`来源、设备采样时间和EMS接收时间写入同一历史库，不另建第二套变量；坏质量、过期、未来时间、未知通道和未知设备均不入库。
