-- v7-chat · Supabase Postgres 云文件元数据副本（一次性迁移）
--
-- 用途：把 cloud_files 元数据镜像到 Supabase Postgres，作为「只读副本 + 跨云灾备」。
--   · D1 仍是唯一真相源；配额强制、扣费、续费、到期收回等正确性路径永远只查 D1。
--   · 高频列表读优先走 PG；PG 未就绪 / 项目暂停 / 超时 / 条数不一致 → 自动回退 D1。
--   · 首次启用后，第一次列表读会自动触发全量回填（pgResync），无需手工导数据。
--
-- 执行方式：Supabase 控制台 → 左侧 SQL Editor → New query → 粘贴本文件 → Run。
-- 只需执行一次；脚本幂等，重复运行无副作用。
-- 说明：项目级 secret key 仅有数据面 CRUD 权限，DDL 必须由控制台 / PAT 执行。
-- 若不执行，网站行为完全不变（副本层自动降级到 D1，零额外开销）。

CREATE TABLE IF NOT EXISTS public.cloud_files_mirror (
  id          text PRIMARY KEY,
  owner       text NOT NULL,
  name        text NOT NULL,
  size        bigint NOT NULL DEFAULT 0,
  mime        text,
  storage     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  synced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cloud_files_mirror_owner_created_idx
  ON public.cloud_files_mirror (owner, created_at DESC);

-- 仅允许服务端 secret key 访问：service_role 自动绕过 RLS，anon/publishable 被拒。
ALTER TABLE public.cloud_files_mirror ENABLE ROW LEVEL SECURITY;

-- 启用校验（可选）：SELECT count(*) FROM public.cloud_files_mirror;
-- 运维自检：GET https://<站点>/api/cloud/pg-health
