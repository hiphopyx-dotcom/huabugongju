CREATE TABLE `studio_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`author` text NOT NULL,
	`name` text NOT NULL,
	`text` text NOT NULL,
	`target` text NOT NULL,
	`created` integer NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_media` (
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`project_id`, `asset_id`)
);
--> statement-breakpoint
CREATE TABLE `studio_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `studio_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	`snapshot` text
);
--> statement-breakpoint
CREATE TABLE `studio_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_versions` (
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`object_key` text NOT NULL,
	`created` integer NOT NULL,
	`author` text NOT NULL,
	PRIMARY KEY(`project_id`, `revision`)
);
