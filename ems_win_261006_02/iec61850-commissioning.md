# IEC 61850 投运门禁

协议模式只允许来自签名配置中的 `protocol.mode`。当前配置格式为 `schemaVersion 4`；旧版本或缺少该字段的配置会迁移为 `DISABLED`，不能自动启用 Modbus 或 IEC 61850。正式升级必须由批准人员补齐字段并重新签名。

`EMS_PROTOCOL_MODE` 不是启用通道，只允许设为 `DISABLED` 做紧急降级。其他值会报 `UNSIGNED_PROTOCOL_OVERRIDE_FORBIDDEN`。配置缺少模式或明确禁用时会报 `PROTOCOL_DISABLED`，并在创建 WebSocket、租约或协议连接前退出。

IEC 61850运行配置目前仍为`MISSING_VENDOR_SCL`。2026-09-11已在`ems技术规范/IEC61850通信测试`收到两份候选RS100 ICD，但尚未通过点表复核、SCL系统集成和多方批准，因此没有直接复制到生产`config/iec61850`目录，也没有改为READY。MMS ICD的SHA-256为`94E6AA73FEC11CA17FB071C732940CB8E4E4ED560D38C0EDC436A0ABB6F3C9D7`，GOOSE ICD为`DFE3BF1A523E348C1C008B39E0FA0BDC8C548C013B122E7302619E0990EE86C4`。只有通道映射、批准SCL文件相对路径及SHA-256均明确，且文件真实路径位于受限根目录内，才可进入后续投运验证。新正式包必须携带schema 4配置及其新签名；旧签名不能复用。

## 页面预检与协议切换

“通信与点表”页面提供IEC 61850投运预检，逐项显示签名协议模式、协调控制器边界、MMS规范点映射、SCL状态和缺失材料。“参数设置”中的协议模式有且只有：`DISABLED`、`MODBUS_TCP_DEBUG_READ_ONLY`、`IEC61850_PRODUCTION`。

模式修改属于根配置修改，必须经过CONFIG_WRITE双人凭证、Ed25519分离签名并重启生效。每次实际模式变化写入集中审计，记录旧模式、新模式和“需重启”结果。若选择`IEC61850_PRODUCTION`时预检未通过，规范化签名接口和保存接口均返回`IEC61850_PRECHECK_FAILED`，配置不会写入。

Windows EMS禁止直接发布GOOSE；一次调频目标只能委托给专用协调控制器。当前协调控制器未配置，预检固定显示`COORDINATOR_NOT_CONFIGURED`。取得厂家材料后，仍须完成SCL、MMS、GOOSE、双网、对时和FAT/SAT，不能仅凭页面显示READY直接投运。

当前RS100 GOOSE ICD只定义PCS向协控发布工作状态、SOC、有功、无功、最大允许充电和最大允许放电功率。文件中没有协控向PCS的命令DataSet/GSEControl，也没有PCS侧`Inputs/ExtRef`订阅绑定。虽然模型里出现有功、无功设定值对象，但不能据此推断反向GOOSE已经可用。必须取得许继协调控制器ICD/IID、完整发布订阅矩阵和批准SCD后才能配置命令方向。

当前RS100 MMS ICD把`UNIT001`配置为`192.168.1.136`，其下包含PCS和BMS两个逻辑设备。网络图显示每台PCS下接2套BMS，BMS通过RS485和常闭干接点接入PCS，因此EMS侧目标按50个`UNITxxx` MMS关联设计。`groupip.xml`目前只有UNIT001；扩展前必须取得50台唯一IP和IED命名表。现有RS61850技术协议写明的是“服务端动态库”，EMS接入现场IED通常需要MMS客户端和报告客户端能力，必须另行确认客户端产品及License。

EMS与协调控制器之间采用传输无关的`PRIMARY_FREQUENCY_ENVELOPE`逻辑契约，而不是把PCC频率采样或每台PCS的毫秒级给定发给Windows。契约固定包含版本、来源、唯一命令号、签发/失效时间、站级有功目标和允许的上下限。发送边界逐项检查当前EMS是否持有主机权限、时间窗、站级绝对功率上限、目标是否位于上下限内及命令号是否重复；协调控制器ACK必须在限定时间内返回、命令号一致且状态为`ACCEPTED`，否则失败关闭并写审计。当前软件默认命令最长有效期5秒、未来时钟容差250毫秒；正式值需按对时方案和一次调频接口设计评审后配置。

这只是软件边界，不代表现场传输已实现。最终可由协调控制器厂家SDK、经认证的MMS控制服务或双方批准的工业协议承载；必须做身份认证、完整性保护、白名单和主备fencing。`CoordinatorBoundary`明确拒绝带`publishGoose`能力的传输对象，Web页面不提供一次调频直接发送按钮，普通Modbus调试服务也不得调用该边界。协调控制器收到有效包后，才在自己的实时任务中读取PCC频率，完成死区/下垂/爬坡/限幅/50台PCS分配并发布GOOSE。

每条MMS映射必须同时给出厂家通道引用、现有EMS设备ID和V1.2规范点名，例如`channel + deviceId + pointName`。预检拒绝没有设备绑定或设备未在EMS启用清单中的映射。厂家协议栈回调进入`Iec61850TelemetryRuntime`后，数据以`IEC61850_MMS`来源、设备采样时间和EMS接收时间写入同一历史库，不另建第二套变量；坏质量、过期、未来时间、未知通道和未知设备均不入库。

## SDK到位前的MMS客户端骨架

2026-09-19已增加SDK无关的MMS客户端基础层：`iec61850-mms-driver.js`定义厂家SDK边界，`iec61850-mms-client.js`管理关联、BRCB/URCB使能、GI、报告转发、诊断和断线重连。`ReplayMmsDriver`只用于离线测试，不得作为生产驱动。

投运预检新增`MMS_CLIENT_DRIVER_NOT_CONFIGURED`。只有配置明确的真实客户端驱动名称，并同时满足批准SCL、哈希、点表映射和协调控制器边界时，生产模式才可READY。候选ICD和回放驱动不会解锁生产通信。
