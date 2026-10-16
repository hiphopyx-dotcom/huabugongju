剧爆棚 · Mac 本机 Grok 授权验证工具 V2

用途
先在你的 Mac mini 上逐个验证官方 Grok Build 的登录与文字调用权限。
这不是已经接通工作台的常驻生成服务，也不代表图片、视频权限可用。
网站管理员账户池仍只保存账户标识与手机号对应关系。

运行
1. 解压到普通文件夹，双击 Start.command。
2. 需要 Node.js 22 或更新版与 npm。缺少时从 https://nodejs.org/ 安装官方 macOS 版本。
3. 首次运行会询问是否安装官方 @xai-official/grok@1.0.60 到本机独立目录。无需 sudo，不会购买订阅。
4. 选 1，输入与管理员账户池一致的账户标识；在官方网页选择正确的 Grok 身份并完成登录。
   如果浏览器自动选中其他账户，请先在官方页面切换到目标账户。
5. 浏览器授权不顺利时可以选 2，按官方设备码流程登录。验证码不要发到聊天中。
6. 选 3，用同一标识执行一次固定文字测试。只有返回 JBP_MAC_TEXT_OK 才算本次文字调用通过。
7. 其他账户重复上述流程；选 4 查看本机进度。
8. 文字测试后自动在工具所在文件夹生成 JBP_Auth_Report_时间戳.json；也可选 5 导出。
   这个报告只含账户标识、测试状态和时间，不含密码、令牌及模型原始回复，可提供给助手排查。
9. 只有 CLI 正常退出并准确返回 JBP_MAC_TEXT_OK 才标记文字验证通过，失败不会冒充成功。

边界
本工具不读取、打印或上传 auth.json 的内容；该文件由官方 CLI 管理。
每个账户标识有独立的 GROK_HOME，不覆盖你原先的 ~/.grok 登录。
标识是你输入的名称，尚未与官方身份进行自动核对。改名会创建新的本机目录，暂时请保持标识一致。
登录记录仅是历史状态，不表示当前会员有效；额度或授权失效时，文字调用可能失败。
首次授权仍需本人确认官方页面显示的账户及权限。
本版本不监听网络端口，不提供公网访问，不自动开机启动，不上传授权到网站。
本机存放位置：~/Library/Application Support/JubaopengGrokAuth/
不要把该目录、auth.json 或授权截图发给别人。

已验证
Linux 环境下核对了官方 CLI 1.0.60 的命令参数，完成账户目录隔离和环境隔离测试。
尚未在你的 Mac mini 上安装、登录或执行真实文字测试；也未验证 Mac 的系统提示。

官方参考
https://docs.x.ai/build/cli/reference
https://docs.x.ai/build/cli/headless-scripting
https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md
