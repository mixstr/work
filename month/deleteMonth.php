<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $sql = file_get_contents(dirname(__DIR__) . '/sql/deleteMonth.sql');
    $sql2 = file_get_contents(dirname(__DIR__) . '/sql/deleteMonthCascade.sql');
    $arguments= [
        'id' => $_GET['id']
    ];
    execution($sql, $arguments);
    execution($sql2, $arguments);
?>