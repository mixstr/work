<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $sql = file_get_contents(dirname(__DIR__) . '/sql/deleteCoefficient.sql');
    $sql2 = file_get_contents(dirname(__DIR__) . '/sql/deleteCoefficientCascade.sql');
    $arguments= [
        'id' => $_GET['id']
    ];
    execution($sql, $arguments);
    execution($sql, $arguments);
?>