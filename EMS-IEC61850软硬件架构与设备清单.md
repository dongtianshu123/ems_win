# 大力枣阳全钒液流储能电站 EMS / IEC 61850 软硬件架构与设备清单

版本：2026-09-11（方案基线）

## 1. 结论

一次调频建议配置独立的站级协调控制器（RTAC/电站控制器）。Windows EMS 不直接承担毫秒级 GOOSE 闭环：EMS负责计划、策略、限值、监视、历史与报表；协调控制器负责频率采样、下垂计算、功率分配、实时联锁和 GOOSE 发布；PCS负责本机快速限幅、保护和执行。

当前编制的 EMS 软件可以继续作为上位 EMS/HMI、Modbus TCP 临时调试、历史与报表、策略影子试算平台，但不能直接等同于已投运的 IEC 61850 一次调频系统。最后投运仍需加入经验证的 IEC 61850 协议栈/协调控制器工程、SCL 工程和现场联调。

## 2. 控制分层与数据流

1. 电网/PCC频率、电压、有功和无功由保护测控装置或高精度电能质量装置采集，并送协调控制器。
2. EMS每秒或更慢计算运行模式、可用容量、SOC窗口、站级计划功率及允许上下限，通过MMS或控制器厂家协议送协调控制器。
3. 协调控制器以确定性周期执行死区、下垂、限幅、爬坡和50台PCS的可用功率分配。
4. 协调控制器以GOOSE发布快速状态/命令；PCS订阅后执行，并由PCS内部保护做最终闭锁。连续功率给定是否可放入GOOSE，必须以PCS厂家PICS/PIXIT和ICD/IID为准，不作先验假定。
5. PCS/BMS运行量、状态、告警和测量值主要由MMS报告上传；调试阶段保留现有Modbus TCP只读链路。
6. EMS保存遥测、事件、指令、日报版本和审批审计；PCC结算表计是收益结算唯一口径，PCS累计量只作设备分析与交叉核对。

EMS下发给协调控制器的不是快速频率闭环，而是短时有效的站级包络：`commandId`、`issuedAt`、`validUntil`、`activePowerMw`、`minPowerMw`和`maxPowerMw`。当前软件边界要求唯一命令号、主机权限、有效时间、目标位于包络内、所有功率不超过项目站级额定值，并校验协调控制器ACK的命令号和状态。超时、拒绝、错配、重复或越限均失败关闭并审计。厂家接口可以采用SDK、MMS控制或经双方批准的协议，但不得让Windows EMS直接获得GOOSE发布能力。

GOOSE是二层以太网组播，不依靠IP路由。工程中要在SCL里明确DataSet、GSEControl、APPID、组播MAC、VLAN ID、VLAN优先级、重发机制和TimeAllowedToLive。MMS运行在TCP/IP上，常用端口102，适合监视、报告和非毫秒级操作。IEC 61850-8-1规定了ACSI到MMS及以太网帧的映射。

## 3. 推荐物理部署

### 3.1 生产推荐：四节点核心

| 设备 | 数量 | 主要职责 | 是否参与快速闭环 |
|---|---:|---|---|
| EMS应用服务器A/B | 2 | HMI、策略、历史、报表、MMS监视、主备 | 否 |
| 协调控制器A/B | 2 | PCC输入、一次调频算法、PCS分配、GOOSE/MMS、硬联锁 | 是 |
| 操作员站 | 1～2 | 浏览器HMI、告警确认、报表 | 否 |
| 工程师站 | 1 | SCL和厂家工具、抓包、维护 | 否 |
| 历史数据库/NAS | 1套或A/B | 长期数据、备份、报表归档 | 否 |

最低限度也应把“EMS服务器”和“协调控制器”分为两类设备。正式电站建议A/B冗余，因此核心为两台EMS服务器加两台协调控制器。历史库可先与EMS同机，容量和可用性要求提高后再独立。

### 3.2 网络

- 过程/站控网络A、B各一套IEC 61850-3管理型交换网络，支持VLAN、802.1p QoS、组播管理、端口镜像、SNMP、PTP；按PCS端口数设计核心加接入层。
- PCS如支持PRP/HSR，优先采用双附着；不支持时用RedBox或厂家认可的冗余方案。
- EMS办公/管理接口与IEC 61850控制网络物理或安全域隔离，通过工业防火墙按白名单放行。
- 调试电脑不得长期桥接互联网与控制网；所有未使用端口关闭。

## 4. 建议硬件规格与采购清单

| 类别 | 建议数量 | 最低建议规格/功能 | 备注 |
|---|---:|---|---|
| EMS工业服务器 | 2 | 8核以上；32～64GB ECC；2×1.92TB企业SSD RAID1；双电源；TPM2.0；至少4个独立千兆口或2个1/10Gb口 | Windows LTSC/Server LTSC版本按业主安全规范确定 |
| 协调控制器/RTAC | 2 | IEC 61850 Ed.2；GOOSE发布/订阅；MMS客户端/服务器；IEC 61131-3或等效实时任务；PTP/IRIG-B；冗余直流电源；PRP/HSR；容量覆盖至少50 PCS、100 BMS和全站点数 | 可参考SEL-3555 RTAC或Siemens SICAM A8000等级，招标保持等效开放 |
| IEC 61850核心交换机 | 2 | IEC 61850-3 Ed.2；足够光电口；VLAN/QoS；PTP；PRP/HSR；GOOSE诊断；冗余电源 | 可参考Moxa PT-G510/PT-G7728等级 |
| 接入交换机/RedBox | 按柜数 | IEC 61850-3；PRP/HSR或RedBox；工业温度；双电源 | 每个网络的端口余量建议不少于20% |
| GNSS/PTP主时钟 | 1套，关键站2套 | GNSS；PTP Power Profile；NTP；IRIG-B；保持振荡器；告警接点；冗余电源 | 可参考SEL-2488等级 |
| 工业防火墙 | 2 | 双机/旁路能力、白名单、审计、VPN维护、IEC协议策略按业主要求 | 置于控制域边界 |
| 操作员站 | 1～2 | 8核；16～32GB；1TB SSD；双网口；双屏 | 浏览器访问EMS，不保存控制私钥 |
| 工程师站 | 1 | 8核；32GB；1TB SSD；双网口 | 安装SCL/厂家配置和协议分析工具 |
| 历史库/NAS | 1套或2 | 8～16核；64GB ECC；RAID10；容量按点数、周期、保留年限核算；离线备份 | 不建议用消费级单盘作唯一历史库 |
| UPS/直流电源 | 2路 | 服务器、控制器、交换机、时钟双路供电；容量覆盖安全停机时间 | 与站用电方案协调 |
| 光模块与光纤 | 按端口+20%备件 | 工业级SFP、单/多模与距离匹配 | A/B网络标识清楚 |
| 测试工具 | 1套 | 支持IEC 61850 MMS/GOOSE/SCL、报文抓取、GOOSE时序与网络负载测试 | 型号须结合业主已有工具选型 |

最终CPU、磁盘和网络容量须用实际点数计算：100套BMS、50套PCS、采样周期、每点字节数、历史保留年限、事件峰值和报表并发是输入，不宜直接照抄样机规格。

## 5. 软件如何分配

### EMS A/B

- 部署当前EMS的生产增强版，而不是开发源码目录。
- 两节点使用相同签名配置，节点ID、服务端口不同；共享主备租约、凭证nonce存储和经验证的数据库复制/备份路径。
- 运行HMI、设备监视、策略计算、收益报表、告警和审计；向协调控制器给出较慢的站级约束，不直接形成毫秒级闭环。
- 生产接口将现有`CoordinatorBoundary`适配到厂家通信SDK；当前仅完成传输无关的包络校验、ACK关联、超时、重复命令和审计，尚未配置现场端点。

### 协调控制器 A/B

- 使用控制器厂家工程软件和运行时，装载一次调频状态机、死区/下垂、功率分配、反向闭锁、质量与超时处理、主备切换。
- 导入全站SCD以及各PCS的ICD/IID，生成本站CID/IID；配置MMS和GOOSE数据集。
- 只有当前主控制器允许发布有效控制；主备切换须用厂家支持的冗余机制和fencing，不能仅靠Windows进程判断。

### PCS/BMS

- PCS配置GOOSE订阅、MMS服务、控制权限、比例/单位、超时回退和本机保护；BMS通常以监视和许可/闭锁为主。
- 保留Modbus TCP仅作临时调试或厂家明确批准的后备通道；禁止两个通道同时拥有控制权。

### 工程师站

- 安装系统配置工具、控制器厂家工具、PCS厂家工具、IEC 61850协议分析/仿真工具、抓包工具。
- 私钥、SCL主版本和变更记录放在受控介质或版本库，不放入工程人员普通便携目录。

## 6. IEC 61850实施前必须向厂家取得的资料

1. 每种PCS、测控装置和控制器的ICD/IID文件、PICS、PIXIT、MICS，以及IEC 61850版本/修订信息。
2. GOOSE可发布/订阅对象清单；尤其确认有功/无功连续设定值究竟采用GOOSE、MMS控制服务，还是PCS本地下垂。
3. 控制模型（direct/SBO、with/without enhanced security）、数据类型CDC、单位、比例、死区、品质位和时间戳语义。
4. GOOSE超时后的PCS安全回退、通信中断闭锁、命令仲裁、Local/Remote和紧停逻辑。
5. PCC频率采样来源、准确度、刷新周期、总响应时间指标及一次调频验收曲线。
6. 交换机端口、VLAN、组播、PRP/HSR、PTP规划和网络安全边界。

## 7. FAT/SAT顺序

1. 离线SCL一致性检查与MMS模型浏览。
2. 单台PCS GOOSE订阅/超时回退测试，只接测试功率或仿真装置。
3. 50台PCS并发GOOSE负载、重发、丢包、交换机重启、A/B网络断链测试。
4. 协调控制器主备切换和双主防护测试。
5. HIL/仿真注入频率阶跃、斜坡和噪声，核对死区、下垂、限幅和总响应时间。
6. EMS与协调控制器接口、模式切换、限值和故障恢复测试。
7. 现场低功率、分级扩功率、正式一次调频验收；每步均保留COMTRADE/抓包/审计证据。

## 8. 官方参考

- IEC 61850-8-1:2011：https://webstore.iec.ch/en/publication/6021
- SEL RTAC：https://selinc.com/products/RTAC/
- SEL-3555资料：https://selinc.com/products/3555/docs/
- Siemens SICAM A8000：https://www.siemens.com/en-us/products/sicam/a8000-cp-8050/
- Moxa PT-G510：https://www.moxa.com/en/products/industrial-network-infrastructure/ethernet-switches/layer-2-managed-switches/pt-g510-series
- Moxa PT-G503 RedBox：https://www.moxa.com/en/products/industrial-network-infrastructure/ethernet-switches/layer-2-managed-switches/pt-g503-series
- SEL-2488时钟：https://selinc.com/products/2488/specs/
