<?php
    global $databasehandler;
    require_once 'configDB.php';
    $sql = 'DELETE FROM employees WHERE id = :id';
    $query = $databasehandler->prepare($sql);
    $query->execute(['id' => 11]);
    ?>
