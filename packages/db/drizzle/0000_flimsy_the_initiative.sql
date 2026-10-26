CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flag_key` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`before_state` text,
	`after_state` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "audit_log_action_check" CHECK("audit_log"."action" IN ('create', 'update', 'archive', 'unarchive', 'kill_switch_on', 'kill_switch_off', 'targeting_update', 'rollback'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_flag_key_id_idx` ON `audit_log` (`flag_key`,`id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flag_environment_companies` (
	`flag_key` text NOT NULL,
	`environment` text NOT NULL,
	`company_id` text NOT NULL,
	`list` text NOT NULL,
	PRIMARY KEY(`flag_key`, `environment`, `company_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`flag_key`,`environment`) REFERENCES `flag_environments`(`flag_key`,`environment`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flag_environment_companies_list_check" CHECK("flag_environment_companies"."list" IN ('allow', 'deny'))
);
--> statement-breakpoint
CREATE TABLE `flag_environments` (
	`flag_key` text NOT NULL,
	`environment` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rollout_percentage` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`flag_key`, `environment`),
	FOREIGN KEY (`flag_key`) REFERENCES `flags`(`key`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flag_environments_environment_check" CHECK("flag_environments"."environment" IN ('development', 'staging', 'production')),
	CONSTRAINT "flag_environments_rollout_check" CHECK("flag_environments"."rollout_percentage" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE `flags` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner` text NOT NULL,
	`expires_at` text NOT NULL,
	`kill_switch` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
