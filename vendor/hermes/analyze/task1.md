<!-- PATH_TEMPLATE: DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

请你在当前目录中完成一次“Docker 测试环境搭建能力测试”。

本任务只测试你是否能够独立创建、构建、启动并验证一个可用的 Docker 开发测试环境。
本题只完成环境搭建和环境验证。

一、总体要求

1. 所有文件必须创建在当前目录中。
2. 不允许把文件创建到 /tmp、用户主目录或其他系统目录。
3. 不允许删除当前目录中已有文件。
4. 不允许在宿主机全局安装 npm、pip、node、python 包等依赖。
5. 所有开发工具和依赖都必须安装在 Docker 镜像或容器中。
6. 必须创建一个可以长期保持运行的 Docker 测试容器。
7. 整个当前目录需要挂载到容器内的 @@DOCKER_WORKSPACE@@，不要再把单独的 ./workspace 文件夹挂载成 @@DOCKER_WORKSPACE@@。
8. 需要真实构建镜像、启动容器并完成环境验证。
9. 不允许只写说明，不允许编造成功结果。

二、需要创建的目录结构

请在当前目录中创建如下结构：

.
├── Dockerfile
├── docker-compose.yml
├── README.md
├── ENV_REPORT.md
├── projects/
├── reports/
└── logs/

三、Docker 环境要求

容器中至少需要包含以下工具：

1. bash
2. git
3. curl
4. wget
5. node.js
6. npm
7. python3
8. pip

Docker Compose 要求：

1. 服务名称使用 @@DOCKER_SERVICE@@。
2. 容器名称使用 @@DOCKER_SERVICE@@。
3. 整个当前目录挂载到容器内 @@DOCKER_WORKSPACE@@，volume 必须使用 `.:@@DOCKER_WORKSPACE@@` 这一类“当前目录整体挂载”的形式。
4. 容器启动后默认保持运行，方便后续进入环境检查。
5. 需要支持以下命令启动环境：

   docker compose up -d --build

6. 需要支持以下命令进入容器：

   docker compose exec @@DOCKER_SERVICE@@ bash

四、验证要求

请真实执行以下步骤：

1. 构建并启动环境：

   docker compose up -d --build

2. 查看容器是否正在运行：

   docker compose ps

3. 在容器内执行环境检查：

   node -v
   npm -v
   python3 --version
   pip --version
   git --version
   curl --version
   wget --version

4. 验证当前目录是否挂载成功：

   在容器内创建文件：

   @@DOCKER_WORKSPACE@@/logs/env_check.txt

   文件中写入：
   - 当前时间
   - node 版本
   - npm 版本
   - python3 版本
   - pip 版本
   - git 版本
   - curl 版本
   - wget 版本

5. 回到宿主机当前目录，确认：

   logs/env_check.txt

   是否真实存在。

五、README.md 要求

README.md 中需要说明：

1. 这个 Docker 测试环境的用途。
2. 如何构建和启动环境。
3. 如何进入容器。
4. 如何查看容器状态。
5. 如何停止环境。
6. 如何清理环境。
7. @@DOCKER_WORKSPACE@@ 挂载目录的作用。

至少包含以下命令说明：

docker compose up -d --build
docker compose ps
docker compose exec @@DOCKER_SERVICE@@ bash
docker compose down
docker compose down --volumes --rmi local

六、ENV_REPORT.md 要求

请生成 ENV_REPORT.md，内容包括：

1. 本次创建了哪些文件和目录。
2. Dockerfile 的主要内容说明。
3. docker-compose.yml 的主要内容说明。
4. 实际执行了哪些命令。
5. 每个环境工具的版本检查结果。
6. @@DOCKER_WORKSPACE@@ 挂载是否成功。
7. env_check.txt 是否成功从容器写入并在宿主机可见。
8. 遇到的问题和修复过程。
9. 最终环境是否验证成功。

七、重要限制

1. 不要在宿主机安装依赖。
2. 不要编造命令执行结果。
3. 所有结论必须来自真实命令输出。
