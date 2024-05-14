<?php
    global $databasehandler;
    $arguments = [
        'id' => $_GET['id'],
        'employee_id' => $_GET['employee_id'],
        'month_id' => $_GET['month_id'],
        'coefficient' => $_GET['coefficient'],
    ];
    require_once (__DIR__ . '/../configDB.php');
    $sql = file_get_contents(__DIR__ . '/../sql/insertcoefficient.sql');
    $query = $databasehandler->prepare($sql);
    $query->execute($arguments);
    ?>
