<?php
    global $databasehandler;
    $arguments = [
        'id' => $_GET['id'],
        'FIO' => $_GET['FIO'],
        'hire_date' => $_GET['hire_date'],
        'termination_date' => $_GET['termination_date'],
    ];
    require_once (__DIR__ . '/../configDB.php');
    $sql = file_get_contents(__DIR__ . '/../sql/insertemployees.sql');
    $query = $databasehandler->prepare($sql);
    $query->execute($arguments);
    ?>
