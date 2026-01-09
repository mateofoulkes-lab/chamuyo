-- Migration for Chamuyo backend
-- Adds request tracking and deck metadata to match frontend schema.

ALTER TABLE `lists`
  ADD COLUMN `slug` varchar(60) DEFAULT NULL AFTER `name`,
  ADD COLUMN `subtitle` varchar(140) DEFAULT NULL AFTER `slug`,
  ADD COLUMN `image_url` varchar(255) DEFAULT NULL AFTER `subtitle`;

UPDATE `lists`
SET `slug` = 'classic'
WHERE `slug` IS NULL AND `is_preset` = 1;

ALTER TABLE `lists`
  ADD UNIQUE KEY `uq_lists_slug` (`slug`);

CREATE TABLE IF NOT EXISTS `requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `room_id` int(11) NOT NULL,
  `type` enum('join','swap','accusation') NOT NULL,
  `status` enum('pending','handled') NOT NULL DEFAULT 'pending',
  `payload` json NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_requests_room` (`room_id`),
  KEY `idx_requests_status` (`status`),
  CONSTRAINT `requests_ibfk_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
