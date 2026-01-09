<?php
$DB_HOST = "localhost";
$DB_NAME = "if0_40856752_chamuyo";
$DB_USER = "root";
$DB_PASS = "";
$DB_CHARSET = "utf8mb4";

function get_pdo(): PDO
{
    global $DB_HOST, $DB_NAME, $DB_USER, $DB_PASS, $DB_CHARSET;
    $dsn = "mysql:host={$DB_HOST};dbname={$DB_NAME};charset={$DB_CHARSET}";
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    return new PDO($dsn, $DB_USER, $DB_PASS, $options);
}
