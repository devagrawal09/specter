ALTER TABLE `mailbox_action_reaction_states` ADD `source` text DEFAULT 'automation' NOT NULL;--> statement-breakpoint
ALTER TABLE `mailbox_action_reaction_states` ADD `authorized_by_rule_id` text;