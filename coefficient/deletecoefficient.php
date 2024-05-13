<?php
    global $databasehandler;
    $arguments= [
        'id' => $_POST['id']
    ];
    require_once (__DIR__ . '/../configDB.php');
    $sql = file_get_contents(__DIR__ . '/../sql/deletecoefficient.sql');
    $query = $databasehandler->prepare($sql);
    $query->execute($arguments);
?>
