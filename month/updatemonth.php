<?php
    global $databasehandler;
    $arguments = [
        'id' => $_GET['id'],
        'name' => $_GET['name'],
        'day' => $_GET['day'],
        'month' => $_GET['month'],
        'year' => $_GET['year'],
    ];
    require_once (__DIR__ . '/../configDB.php');
    $sql = file_get_contents(__DIR__ . '/../sql/updatemonth.sql');
    $query = $databasehandler->prepare($sql);
    $query->execute($arguments);
    ?>
