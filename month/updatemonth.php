<?php
global $databasehandler;
$arguments = [
    'id' => $_POST['id'],
    'name' => $_POST['name'],
    'day' => $_POST['day'],
    'month' => $_POST['month'],
    'year' => $_POST['year'],
];
require_once (__DIR__ . '/../configDB.php');
$sql = file_get_contents(__DIR__ . '/../sql/updatemonth.sql');
$query = $databasehandler->prepare($sql);
$query->execute($arguments);
?><?php
